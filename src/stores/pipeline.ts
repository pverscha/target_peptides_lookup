import { defineStore } from 'pinia'
import { ref, readonly, computed } from 'vue'
import type { PipelineStep, PipelineStatus, LogEntry, AnalysisSnapshot, TaxonSuggestion } from '@/types'
import { useConfigStore } from './config'
import { UnipeptService, UNIQUE_PEPTIDES_BATCH_SIZE } from '@/services/UnipeptService'
import { TaxonRepository } from '@/repositories/TaxonRepository'
import { chunked, intersectSets, unionSets } from '@/utils/peptides'
import { fmtN, fmtPercent, formatLogLines } from '@/utils/format'
import { downloadText } from '@/utils/download'
import { isAbortError } from '@/utils/abort'
import { isLeafRank } from "@/utils/taxa.ts"
import { RequestPool } from '@/utils/RequestPool'
import { PauseController } from '@/utils/PauseController'
import { RetryController } from '@/utils/RetryController'

const LOG_UI_LIMIT = 100
const SHARED_PEPTIDES_BATCH_SIZE = 20

// A run is "active" while it is still in progress (including when suspended);
// "finished" once it has reached a terminal state. Shared with usePipelineStatus.
export const ACTIVE_STATUSES: PipelineStatus[] = ['running', 'paused', 'interrupted']
export const FINISHED_STATUSES: PipelineStatus[] = ['done', 'error', 'cancelled']

const STEP_DEFS = [
  { id: 'validate',    label: 'Validate taxon IDs' },
  { id: 'descendants', label: 'Collect species-level descendants' },
  { id: 'intersect',   label: 'Compute shared peptides' },
  { id: 'lca',         label: 'Look up LCAs' },
  { id: 'protein_counts',  label: 'Fetching protein counts' },
  { id: 'peptide_coverage', label: 'Computing peptide coverage' },
] as const

type StepId = typeof STEP_DEFS[number]['id']

function makeSteps(): PipelineStep[] {
  return STEP_DEFS.map(({ id, label }) => ({
    id,
    label,
    status: 'idle',
    progress: null,
    detail: '',
  }))
}

export const usePipelineStore = defineStore('pipeline', () => {
  const config = useConfigStore()

  const status = ref<PipelineStatus>('idle')
  const steps = ref<PipelineStep[]>(makeSteps())
  // Full log buffer — plain array, not reactive, so Vue never tracks individual entries.
  let _allLogs: LogEntry[] = []
  // Reactive count of all log entries (for UI badges and download-button disabled state).
  const allLogsCount = ref(0)
  // Reactive UI slice: at most LOG_UI_LIMIT most recent entries.
  const logs = ref<LogEntry[]>([])

  // The taxa the user submitted as input (may include invalid IDs).
  const inputTaxa = ref<TaxonSuggestion[]>([])
  // Subset of inputTaxa IDs confirmed to exist in Unipept's taxonomy database.
  const validTaxaIds = ref<number[]>([])
  // Display name for each validated taxon ID (id → name).
  const taxonNames = ref<Record<number, string>>({})
  // Flat list of every unique species-level descendant across all valid input taxa.
  const descendantIds = ref<number[]>([])
  // Maps each input taxon ID to the list of its species-level descendants.
  const descendantsByTaxon = ref<Record<number, number[]>>({})
  // The global core peptidome: peptides shared across ALL species descendants of ALL input taxa.
  const intersectionPeptides = ref<string[]>([])
  // Subset of intersectionPeptides that are globally unique (no organism outside the input
  // taxon set in the entire Unipept database has this peptide).
  const uniquePeptides = ref<string[]>([])
  // Per-taxon unique peptides: for each input taxon, the subset of intersectionPeptides that
  // are globally unique to at least one species descendant of that taxon (leaf taxa), or the
  // partially-covering peptides sorted by descendant coverage (higher-level taxa).
  const perTaxonUniquePeptides = ref<Record<number, string[]>>({})
  // Per-taxon coverage data: populated only for higher-level (non-species/strain) input taxa.
  // Maps each higher-level taxon ID to a peptide → list of descendant species IDs that had
  // that peptide in their unique_to_parent response. The coverage percentage for a peptide is
  // coverage[taxId][peptide].length / descendantsByTaxon[taxId].length.
  const perTaxonCoverage = ref<Record<number, Record<string, number[]>>>({})
  // Taxonomic rank for each valid input taxon (id → rank string, e.g. "species", "genus").
  // Populated from inputTaxa and kept as persistent state so downstream steps and the UI
  // can classify taxa without rebuilding a temporary lookup on every run.
  const taxonRanks = ref<Record<number, string>>({})
  // LCA metadata for every peptide submitted to pept2lca, keyed by peptide sequence.
  const lcaByPeptide = ref<Record<string, { id: number; name: string; rank: string }>>({})

  const perTaxonUniqueComputed = ref(false)
  const uniqueSharedPeptidesComputed = ref(false)

  const _restoredFromHistory = ref(false)

  let abortController: AbortController | null = null
  let pauseController: PauseController | null = null
  let retryController: RetryController | null = null

  function setStep(id: StepId, patch: Partial<PipelineStep>) {
    steps.value = steps.value.map((s) => (s.id === id ? { ...s, ...patch } : s))
  }

  function addLog(level: LogEntry['level'], message: string) {
    const entry: LogEntry = { level, message, timestamp: new Date() }
    _allLogs.push(entry)
    allLogsCount.value++
    logs.value.push(entry)
    if (logs.value.length > LOG_UI_LIMIT) {
      logs.value = _allLogs.slice(-LOG_UI_LIMIT)
    }
  }

  function resetState() {
    _allLogs = []
    allLogsCount.value = 0
    logs.value = []
    inputTaxa.value = []
    validTaxaIds.value = []
    taxonNames.value = {}
    descendantIds.value = []
    descendantsByTaxon.value = {}
    intersectionPeptides.value = []
    uniquePeptides.value = []
    perTaxonUniquePeptides.value = {}
    perTaxonCoverage.value = {}
    taxonRanks.value = {}
    lcaByPeptide.value = {}
    perTaxonUniqueComputed.value = false
    uniqueSharedPeptidesComputed.value = false
    steps.value = makeSteps()
  }

  /**
   * Validates a list of NCBI taxon IDs against the Unipept database.
   * Logs a warning for each unknown ID and throws if none are valid.
   * Updates `validTaxaIds` and `taxonNames` with the accepted results.
   *
   * @param inputTaxaIds - NCBI taxon IDs to validate.
   * @param taxonRepo - Repository used to query taxon validity.
   * @param signal - AbortSignal to cancel the request.
   * @returns The subset of `inputTaxaIds` that are known to Unipept.
   * @throws If none of the provided IDs are valid.
   */
  async function validateInputTaxa(
      inputTaxaIds: number[],
      taxonRepo: TaxonRepository,
      signal: AbortSignal,
  ) {
    setStep('validate', { status: 'running', progress: null, detail: `Checking ${fmtN(inputTaxaIds.length)} IDs…` });

    const { valid, invalid, names } = await taxonRepo.validate(
        inputTaxaIds, signal,
        (done, total) => setStep('validate', { progress: done / total, detail: fmtPercent(done, total) }),
    )

    for (const id of invalid) {
      addLog('warning', `Unknown taxon ID: ${id}`);
    }

    if (valid.length === 0) {
      throw new Error('None of the provided taxon IDs are known to Unipept.')
    }

    validTaxaIds.value = valid;
    taxonNames.value = names;

    setStep('validate', { status: 'done', progress: 1, detail: `${fmtN(valid.length)}/${fmtN(inputTaxaIds.length)} valid` });

    return valid;
  }

  /**
   * Fetches all species-level descendants for the validated input taxa.
   * Converts each taxon ID with no species-level descendants into a warning
   * log entry, and throws if none are found across all input taxa.
   * Updates `descendantIds` and `descendantsByTaxon` with the results.
   *
   * @param validTaxa - NCBI taxon IDs confirmed to exist in Unipept.
   * @param taxonRepo - Repository used to fetch descendant data.
   * @param signal - AbortSignal to cancel the request.
   * @returns Object with `descendants` (deduplicated union of all species-level
   *   descendant IDs) and `descendantsPerTaxon` (per-input-taxon descendant lists).
   * @throws If no species-level descendants are found for any input taxon.
   */
  async function computeDescendants(
    validTaxa: number[],
    taxonRepo: TaxonRepository,
    signal: AbortSignal,
  ) {
    setStep('descendants', { status: 'running', progress: null, detail: 'Fetching…' });

    const { descendants, descendantsPerTaxon, taxaWithoutDescendants } = await taxonRepo.getDescendants(
        validTaxa, signal,
        (done, total) => setStep('descendants', { progress: done / total, detail: fmtPercent(done, total) }),
    )

    for (const id of taxaWithoutDescendants) {
      addLog('warning', `Taxon ${id} has no species-level descendants`);
    }

    if (descendants.length === 0) {
      throw new Error('No species-level descendants found for any input taxon.');
    }

    descendantIds.value = descendants;
    descendantsByTaxon.value = descendantsPerTaxon;

    setStep('descendants', { status: 'done', progress: 1, detail: `${fmtN(descendants.length)} species` });
    addLog('info', `Collected ${fmtN(descendants.length)} unique species-level descendants.`);

    return { descendants, descendantsPerTaxon };
  }

  /**
   * Computes the global core peptidome: the set of tryptic peptides shared
   * across ALL species-level descendants of the input taxa.
   *
   * Descendants are split into batches of `SHARED_PEPTIDES_BATCH_SIZE` and
   * queried in parallel (up to `config.parallelRequests` concurrent requests).
   * The per-batch peptide sets are intersected to produce the global core.
   * Updates `intersectionPeptides` with the sorted result.
   *
   * @param descendants - Deduplicated species-level descendant taxon IDs.
   * @param cleavageRegex
   * @param taxonRepo - Repository used to fetch shared peptides per batch.
   * @param signal - AbortSignal to cancel the request.
   * @returns Sorted array of peptide sequences present in every descendant's proteome.
   */
  async function computeSharedPeptides(
    descendants: number[],
    cleavageRegex: string,
    taxonRepo: TaxonRepository,
    signal: AbortSignal
  ) {
    setStep('intersect', { status: 'running', progress: null, detail: 'Requesting shared peptides…' })
    const batches = chunked(descendants, SHARED_PEPTIDES_BATCH_SIZE)

    const pool = new RequestPool(config.parallelRequests, pauseController)
    const batchSets = await pool.execute(
      batches,
      (batch) => taxonRepo.getSharedPeptides(batch, cleavageRegex, config.minLength, signal)
        .then(peps => new Set<string>(peps)),
      (done, total) => setStep('intersect', { progress: done / total, detail: fmtPercent(done, total) }),
    )

    const globalCore: Set<string> = batchSets.filter((s): s is Set<string> => s !== null).reduce((a, b) => intersectSets(a, b))
    const core: string[] = [...globalCore].sort()
    intersectionPeptides.value = core

    setStep('intersect', {
      status: 'done',
      progress: 1,
      detail: core.length === 0 ? 'No shared peptides' : `${fmtN(core.length)} shared peptides`,
    })

    addLog('info', `Global core peptidome size: ${fmtN(core.length)}`);

    if (core.length === 0) {
      addLog('info', 'No shared peptides found.');
    }

    return core;
  }

  /**
   * Looks up the LCA taxon for each peptide in the global core peptidome.
   * Skips the step entirely when `core` is empty.
   * Logs a warning for any peptide not found in Unipept.
   * Updates `lcaByPeptide` with the results.
   *
   * @param core - Tryptic peptide sequences from the global core peptidome.
   * @param taxonRepo - Repository used to query LCA data.
   * @param signal - AbortSignal to cancel the request.
   */
  async function lookupLcas(
      core: string[],
      taxonRepo: TaxonRepository,
      signal: AbortSignal
  ) {
    if (core.length > 0) {
      setStep('lca', { status: 'running', progress: null, detail: 'Querying Unipept pept2lca…' })
      const { lcaByPeptide: lcaMap } = await taxonRepo.getLcas(
          core, signal,
          (done, total) => {
            setStep('lca', { progress: done / total, detail: fmtPercent(done, total) })
          },
      )
      const missing = core.filter((p) => !lcaMap.has(p))
      for (const p of missing) addLog('warning', `No LCA returned for peptide: ${p}`)
      lcaByPeptide.value = Object.fromEntries(lcaMap)
      setStep('lca', { status: 'done', progress: 1, detail: `${fmtN(lcaMap.size)} LCAs retrieved` })
    } else {
      setStep('lca', { status: 'skipped', detail: 'Skipped — empty intersection' })
    }
  }

  /**
   * Determines which shared core peptides are globally unique to the input taxon group.
   *
   * For each peptide in `core`, the Unipept `pept2taxa` endpoint returns every organism
   * carrying that peptide. A peptide is globally unique when all species-level taxa
   * returned by `pept2taxa` are members of the input group's species-level descendants.
   * Peptides absent from the response or carrying species outside the allowed set are
   * excluded from the result.
   *
   * Logs a warning for each peptide not found in the response and for each peptide for
   * which `pept2taxa` applied a truncation cutoff (its species set may be incomplete,
   * risking a false "unique" classification).
   *
   * Updates the `filter` step UI with progress and marks it `done` on completion.
   *
   * @param core - Sorted tryptic peptide sequences from the global core peptidome.
   * @param descendants - All species-level descendant taxon IDs of the input taxa.
   * @param taxonRepo - Repository used to query `pept2taxa`.
   * @param signal - AbortSignal to cancel the request.
   * @returns Sorted array of globally unique peptides (subset of `core`).
   */
  async function computeGloballyUniquePeptides(
    core: string[],
    descendants: number[],
    taxonRepo: TaxonRepository,
    signal: AbortSignal,
  ): Promise<string[]> {
    setStep('peptide_coverage', { status: 'running', progress: null, detail: 'Querying pept2taxa…' })

    const { taxaByPeptide, cutoffPeptides } = await taxonRepo.getTaxa(
      core,
      signal,
      (done, total) => setStep('peptide_coverage', { progress: done / total, detail: fmtPercent(done, total) }),
    )

    const allowed = new Set(descendants)

    const missing = core.filter((p) => !taxaByPeptide.has(p))
    for (const p of missing) addLog('warning', `pept2taxa returned no result for peptide: ${p}`)

    for (const p of cutoffPeptides) {
      addLog('warning', `pept2taxa result truncated for peptide (cutoff applied): ${p} — uniqueness classification may be inaccurate`)
    }

    const unique = core.filter((p) => {
      const sp = taxaByPeptide.get(p)
      return sp !== undefined && sp.size > 0 && [...sp].every((id) => allowed.has(id))
    })

    return unique
  }

  /**
   * Computes per-taxon unique and partially-covering peptides, then runs the
   * globally-unique shared peptide filter. Directly updates the pipeline store
   * refs `perTaxonUniquePeptides`, `perTaxonCoverage`, `perTaxonUniqueComputed`,
   * `uniquePeptides`, and `uniqueSharedPeptidesComputed`, and advances the
   * `filter` step UI.
   *
   * **Early-exit.** When `sharedPeptides` is empty and
   * `config.computePerTaxonUnique` is disabled, the step is marked skipped and
   * `status` is set to `done`; no API calls are made and the function returns
   * `undefined`.
   *
   * **Per-taxon logic.** Input taxa are classified by rank:
   *
   * - *Leaf taxa* (species / strain): `getUniquePeptides` is called once for
   *   the taxon ID without a parent. The returned `unique` set — peptides not
   *   present in any other organism in Unipept — is stored in `uniquePerSpecies`.
   *
   * - *Higher-level taxa* (genus, family, …): `getUniquePeptides` is called for
   *   every species-level descendant with the parent taxon ID. Each call returns
   *   both `unique` (per-species strict-unique peptides, cached in
   *   `uniquePerSpecies`) and `uniqueToParent` (peptides unique to the parent
   *   but not strictly to the species). The `uniqueToParent` lists are aggregated
   *   into a coverage map: `coverage[parentId][peptide]` is the list of
   *   descendant species IDs in whose `uniqueToParent` response that peptide
   *   appeared. The coverage percentage for a peptide is
   *   `coverage[parentId][peptide].length / descendantsPerTaxon[parentId].length`.
   *
   * **Store assignment.**
   * `perTaxonCoverage` receives the raw coverage map. `perTaxonUniquePeptides`
   * is built per input taxon: leaf taxa get their sorted strict-unique list;
   * higher-level taxa get their partially-covering peptides sorted by descending
   * coverage count (tiebroken by peptide sequence). `perTaxonUniqueComputed` is
   * set to `true` when at least one input taxon has a non-empty peptide list.
   *
   * **Globally-unique shared peptides.** After the per-taxon work, if
   * `config.computeUniqueSharedPeptides` is enabled and `sharedPeptides` is
   * non-empty, `computeGloballyUniquePeptides` is invoked and its result stored
   * in `uniquePeptides`. Otherwise the filter step is marked skipped.
   *
   * @param validTaxa - NCBI taxon IDs confirmed to exist in Unipept.
   * @param sharedPeptides - Global core peptidome (intersection across all descendants).
   * @param descendants - Flat union of all species-level descendant IDs.
   * @param descendantsPerTaxon - Maps each input taxon ID to its species-level descendant IDs.
   * @param cleavageRegex - Regex used to digest proteins into peptides.
   * @param taxonRepo - Repository for Unipept API calls.
   * @param signal - AbortSignal to cancel in-flight requests.
   */
  async function computeUniqueAndPartialPeptides(
    validTaxa: number[],
    sharedPeptides: string[],
    descendants: number[],
    descendantsPerTaxon: Record<number, number[]>,
    cleavageRegex: string,
    taxonRepo: TaxonRepository,
    signal: AbortSignal
  ) {
    if (sharedPeptides.length === 0 && !config.computePerTaxonUnique) {
      setStep('protein_counts', { status: 'skipped', detail: 'Skipped — empty intersection' })
      setStep('peptide_coverage', { status: 'skipped', detail: 'Skipped — empty intersection' })
      status.value = 'done'
      return
    }

    const isLeafTaxon = (id: number): boolean => isLeafRank(taxonRanks.value[id])

    // === Phase 1: Count ===
    // Build the flat list of (taxonId, parentId?) jobs and fetch protein counts
    // concurrently so we know how many page requests each taxon will need.
    type TaxonJob = { taxonId: number; parentId?: number }
    const taxonJobs: TaxonJob[] = []

    for (const parentId of validTaxa) {
      if (isLeafTaxon(parentId)) {
        taxonJobs.push({ taxonId: parentId })
      } else {
        for (const speciesId of descendantsPerTaxon[parentId]!) {
          taxonJobs.push({ taxonId: speciesId, parentId })
        }
      }
    }

    // Count is independent of parentId — deduplicate by taxonId.
    const uniqueTaxonIds = [...new Set(taxonJobs.map((j) => j.taxonId))]

    setStep('protein_counts', { status: 'running', progress: null, detail: 'Fetching protein counts…' })
    const countPool = new RequestPool(config.parallelRequests, pauseController)
    const countResults = await countPool.execute(
      uniqueTaxonIds,
      (taxonId) => taxonRepo.getUniquePeptidesCount(taxonId, signal),
      (done, total) => setStep('protein_counts', { progress: done / total, detail: `Fetching protein counts… ${fmtPercent(done, total)}` }),
    )

    const countByTaxon = new Map(uniqueTaxonIds.map((id, i) => [id, countResults[i] ?? 0]))
    setStep('protein_counts', { status: 'done', progress: 1, detail: '' })

    // === Phase 2: Plan ===
    // From the counts, build the complete flat list of page requests up front.
    type PageRequest = TaxonJob & { start: number; end: number }
    const pageRequests: PageRequest[] = []

    for (const job of taxonJobs) {
      const count = countByTaxon.get(job.taxonId) ?? 0
      for (let start = 0; start < count; start += UNIQUE_PEPTIDES_BATCH_SIZE) {
        pageRequests.push({ ...job, start, end: start + UNIQUE_PEPTIDES_BATCH_SIZE })
      }
    }

    // === Phase 3: Execute ===
    // Run all page requests concurrently, bounded by config.parallelRequests.
    setStep('peptide_coverage', { status: 'running', progress: null, detail: 'Fetching unique peptides…' })
    const pagePool = new RequestPool(config.parallelRequests, pauseController)
    const pageResults = await pagePool.execute(
      pageRequests,
      (req) => taxonRepo.getUniquePeptidesRange(req.taxonId, req.start, req.end, cleavageRegex, config.minLength, signal, req.parentId),
      (done, total) => setStep('peptide_coverage', { progress: done / total, detail: `Fetching unique peptides… ${fmtPercent(done, total)}` }),
    )

    // === Phase 4: Aggregate ===
    const uniquePerSpecies = new Map<number, Set<string>>()
    // Use Set<number> during aggregation to deduplicate species IDs in O(1) per insert.
    const coverageSets: Record<number, Record<string, Set<number>>> = {}

    for (const parentId of validTaxa) {
      if (!isLeafTaxon(parentId)) coverageSets[parentId] = {}
    }

    for (let i = 0; i < pageRequests.length; i++) {
      const req = pageRequests[i]!
      const result = pageResults[i]
      if (!result) continue

      if (!uniquePerSpecies.has(req.taxonId)) {
        uniquePerSpecies.set(req.taxonId, new Set())
      }
      for (const p of result.unique) uniquePerSpecies.get(req.taxonId)!.add(p)

      if (req.parentId !== undefined) {
        const cov = coverageSets[req.parentId]!
        for (const p of result.uniqueToParent) {
          if (cov[p] === undefined) cov[p] = new Set()
          cov[p].add(req.taxonId)
        }
      }
    }

    // Convert Set<number> → number[] for the store type.
    const coverage: Record<number, Record<string, number[]>> = {}
    for (const [parentId, pepMap] of Object.entries(coverageSets)) {
      coverage[Number(parentId)] = Object.fromEntries(
        Object.entries(pepMap).map(([pep, ids]) => [pep, [...ids]])
      )
    }

    // Populate per-taxon store refs from the computed results.
    perTaxonCoverage.value = coverage;

    const perTaxon: Record<number, string[]> = {}
    for (const id of validTaxa) {
      if (isLeafRank(taxonRanks.value[id])) {
        // Leaf taxon (species/strain): strict-unique peptides, sorted for stable display.
        perTaxon[id] = [...(uniquePerSpecies.get(id) ?? [])].sort()
      } else {
        // Higher-level taxon: partially-covering peptides ordered by descendant
        // coverage (desc), with peptide sequence as tiebreaker.
        const cov = coverage[id] ?? {}

        perTaxon[id] = Object.keys(cov).sort(
            (a, b) => (cov[b]!.length - cov[a]!.length) || a.localeCompare(b)
        )
      }
    }
    perTaxonUniquePeptides.value = perTaxon;

    // Mark the per-taxon section as computed so the UI accordion renders.
    perTaxonUniqueComputed.value = Object.values(perTaxon).some((list) => list.length > 0);

    if (config.computeUniqueSharedPeptides && sharedPeptides.length > 0) {
      uniquePeptides.value = await computeGloballyUniquePeptides(sharedPeptides, descendants, taxonRepo, signal)
      uniqueSharedPeptidesComputed.value = true
      setStep('peptide_coverage', { status: 'done', progress: 1, detail: `${fmtN(uniquePeptides.value.length)} globally unique` })
      addLog('info', `Globally unique peptides: ${fmtN(uniquePeptides.value.length)}`)
    } else {
      setStep('peptide_coverage', { status: 'done', progress: 1, detail: 'Per-taxon coverage computed' })
    }
  }

  async function run(taxa: TaxonSuggestion[]) {
    if (ACTIVE_STATUSES.includes(status.value)) return

    _restoredFromHistory.value = false
    resetState()
    inputTaxa.value = taxa
    for (const t of taxa) taxonRanks.value[t.id] = t.rank
    const inputTaxaIds = taxa.map((t) => t.id)
    abortController = new AbortController()
    const signal = abortController.signal
    pauseController = new PauseController()
    retryController = new RetryController(() => {
      status.value = 'interrupted'
      addLog('warning', 'Network request failed. Analysis paused — click Resume when your connection is back.')
    })
    status.value = 'running'

    const taxonRepo = new TaxonRepository(new UnipeptService({
      unipeptUrl: config.unipeptUrl,
      batchSize: config.batchSize,
      lcaBatchSize: config.lcaBatchSize,
      parallelRequests: config.parallelRequests,
      equateIL: config.equateIL,
    }, pauseController, retryController))

    const cleavageRegex = config.cleavageMethod === 'tryptic' ? '[KR](?!P)' : config.cleavageRegex

    try {
      // Step 1: Validate input taxa
      const validTaxa = await validateInputTaxa(inputTaxaIds, taxonRepo, signal);

      // Step 2: Compute descendants at species and strain level
      const { descendants, descendantsPerTaxon } = await computeDescendants(validTaxa, taxonRepo, signal);

      // ── Step 3: Compute shared peptides ─────────────────────────────────────
      const sharedPeptides = await computeSharedPeptides(descendants, cleavageRegex, taxonRepo, signal);

      // ── Step 4: LCA lookup ──────────────────────────────────────────────────
      await lookupLcas(sharedPeptides, taxonRepo, signal);

      // ── Steps 5–6: Protein counts and peptide coverage ─────────────────────
      await computeUniqueAndPartialPeptides(validTaxa, sharedPeptides, descendants, descendantsPerTaxon, cleavageRegex, taxonRepo, signal);

      status.value = 'done'
    } catch (err: unknown) {
      if (isAbortError(err)) {
        status.value = 'cancelled'
        addLog('info', 'Pipeline cancelled by user.')
        for (const s of steps.value) {
          if (s.status === 'running') setStep(s.id as StepId, { status: 'idle', detail: 'Cancelled' })
        }
      } else {
        status.value = 'error'
        const msg = err instanceof Error ? err.message : String(err)
        addLog('error', msg)
        for (const s of steps.value) {
          if (s.status === 'running') setStep(s.id as StepId, { status: 'error', detail: msg })
        }
      }
    } finally {
      abortController = null
      pauseController = null
      retryController = null
    }
  }

  function pause() {
    if (status.value !== 'running') return
    pauseController?.pause()
    status.value = 'paused'
    addLog('info', 'Pipeline paused.')
  }

  function resume() {
    if (status.value === 'paused') {
      pauseController?.resume()
      status.value = 'running'
      addLog('info', 'Pipeline resumed.')
    } else if (status.value === 'interrupted') {
      status.value = 'running'
      addLog('info', 'Retrying after connection loss…')
      retryController?.resume()
    }
  }

  function cancel() {
    abortController?.abort()
    // Release any parked workers/requests so they wake into the aborted signal and unwind.
    pauseController?.resume()
    retryController?.resume()
  }

  function reset() {
    cancel()
    _restoredFromHistory.value = false
    resetState()
    status.value = 'idle'
  }

  function loadSaved(snapshot: AnalysisSnapshot) {
    resetState()
    _restoredFromHistory.value = true
    inputTaxa.value = snapshot.inputTaxa ?? []
    if (snapshot.analysisConfig) {
      config.applyAnalysisParams(snapshot.analysisConfig)
    }
    validTaxaIds.value = snapshot.inputTaxonIds
    taxonNames.value = snapshot.taxonNames
    descendantIds.value = snapshot.descendantIds
    descendantsByTaxon.value = snapshot.descendantsByTaxon
    intersectionPeptides.value = snapshot.intersectionPeptides
    uniquePeptides.value = snapshot.uniquePeptides
    perTaxonUniquePeptides.value = snapshot.perTaxonUniquePeptides
    perTaxonCoverage.value = snapshot.perTaxonCoverage ?? {}
    taxonRanks.value = Object.fromEntries((snapshot.inputTaxa ?? []).map((t) => [t.id, t.rank]))
    lcaByPeptide.value = snapshot.lcaByPeptide
    _allLogs = snapshot.logs.map((l) => ({ ...l, timestamp: new Date(l.timestamp) }))
    allLogsCount.value = _allLogs.length
    logs.value = _allLogs.slice(-LOG_UI_LIMIT)
    steps.value = makeSteps().map((s) => ({ ...s, status: 'done', progress: 1 }))
    perTaxonUniqueComputed.value = true
    uniqueSharedPeptidesComputed.value = true
    status.value = 'done'
  }

  function getAllLogs(): readonly LogEntry[] {
    return _allLogs
  }

  function downloadLogs(): void {
    downloadText(formatLogLines(_allLogs), 'pipeline-log.txt')
  }

  return {
    status: readonly(status),
    steps: readonly(steps),
    logs: readonly(logs),
    allLogsCount: readonly(allLogsCount),
    inputTaxa: readonly(inputTaxa),
    validTaxaIds: readonly(validTaxaIds),
    taxonNames: readonly(taxonNames),
    descendantIds: readonly(descendantIds),
    descendantsByTaxon: readonly(descendantsByTaxon),
    intersectionPeptides: readonly(intersectionPeptides),
    uniquePeptides: readonly(uniquePeptides),
    perTaxonUniquePeptides: readonly(perTaxonUniquePeptides),
    perTaxonCoverage: readonly(perTaxonCoverage),
    taxonRanks: readonly(taxonRanks),
    lcaByPeptide: readonly(lcaByPeptide),
    perTaxonUniqueComputed: readonly(perTaxonUniqueComputed),
    uniqueSharedPeptidesComputed: readonly(uniqueSharedPeptidesComputed),
    isRestoredSnapshot: readonly(computed(() => _restoredFromHistory.value)),
    getAllLogs,
    downloadLogs,
    run,
    pause,
    resume,
    cancel,
    reset,
    loadSaved,
  }
})
