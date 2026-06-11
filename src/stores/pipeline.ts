import { defineStore } from 'pinia'
import { ref, readonly, computed } from 'vue'
import type { PipelineStep, PipelineStatus, LogEntry, AnalysisSnapshot, TaxonSuggestion } from '@/types'
import { useConfigStore } from './config'
import { UnipeptService } from '@/services/UnipeptService'
import { TaxonRepository } from '@/repositories/TaxonRepository'
import { chunked, intersectSets, unionSets, isLeafRank } from '@/utils/peptides'
import { fmtN, fmtPercent, formatLogLines } from '@/utils/format'
import { downloadText } from '@/utils/download'
import { isAbortError } from '@/utils/abort'

const LOG_UI_LIMIT = 100
const SHARED_PEPTIDES_BATCH_SIZE = 20

const STEP_DEFS = [
  { id: 'validate',    label: 'Validate taxon IDs' },
  { id: 'descendants', label: 'Collect species-level descendants' },
  { id: 'intersect',   label: 'Compute shared peptides' },
  { id: 'lca',         label: 'Look up LCAs' },
  { id: 'filter',      label: 'Apply uniqueness filter' },
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
   * @param taxonRepo - Repository used to fetch shared peptides per batch.
   * @param cleavageRegex - Regular expression used to cleave protein sequences
   *   into peptides (e.g. `[KR](?!P)` for trypsin).
   * @param signal - AbortSignal to cancel the request.
   * @returns Sorted array of peptide sequences present in every descendant's proteome.
   */
  async function computeSharedPeptides(
    descendants: number[],
    taxonRepo: TaxonRepository,
    cleavageRegex: string,
    signal: AbortSignal
  ) {
    setStep('intersect', { status: 'running', progress: null, detail: 'Requesting shared peptides…' })
    const batches = chunked(descendants, SHARED_PEPTIDES_BATCH_SIZE)
    let batchesDone = 0
    let nextBatchIdx = 0
    const batchSets: Set<string>[] = new Array(batches.length)

    const sharedWorker = async (): Promise<void> => {
      let idx: number
      while ((idx = nextBatchIdx++) < batches.length) {
        const peps = await taxonRepo.getSharedPeptides(batches[idx]!, cleavageRegex, config.minLength, signal)
        batchSets[idx] = new Set<string>(peps)
        batchesDone++
        setStep('intersect', {
          progress: batchesDone / batches.length,
          detail: fmtPercent(batchesDone, batches.length),
        })
      }
    }

    const sharedWorkerCount = Math.min(config.parallelRequests, batches.length)
    await Promise.all(Array.from({ length: sharedWorkerCount }, sharedWorker))
    const globalCore: Set<string> = batchSets.reduce((a, b) => intersectSets(a, b))
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

  async function run(taxa: TaxonSuggestion[]) {
    if (status.value === 'running') return

    _restoredFromHistory.value = false
    resetState()
    inputTaxa.value = taxa
    for (const t of taxa) taxonRanks.value[t.id] = t.rank
    const inputTaxaIds = taxa.map((t) => t.id)
    abortController = new AbortController()
    const signal = abortController.signal
    status.value = 'running'

    const taxonRepo = new TaxonRepository(new UnipeptService({
      unipeptUrl: config.unipeptUrl,
      batchSize: config.batchSize,
      lcaBatchSize: config.lcaBatchSize,
      parallelRequests: config.parallelRequests,
      equateIL: config.equateIL,
    }))

    const cleavageRegex = config.cleavageMethod === 'tryptic' ? '[KR](?!P)' : config.cleavageRegex

    try {
      // ── Step 1: Validate ────────────────────────────────────────────────────
      const validTaxa = await validateInputTaxa(inputTaxaIds, taxonRepo, signal);

      // ── Step 2: Descendants ─────────────────────────────────────────────────
      const { descendants, descendantsPerTaxon } = await computeDescendants(validTaxa, taxonRepo, signal);

      // ── Step 3: Compute shared peptides ─────────────────────────────────────
      const core = await computeSharedPeptides(descendants, taxonRepo, cleavageRegex, signal);

      // ── Step 4: LCA lookup ──────────────────────────────────────────────────
      await lookupLcas(core, taxonRepo, signal);

      // ── Step 5: Uniqueness filter ───────────────────────────────────────────
      // Uses the unique_peptides endpoint to determine which peptides are globally
      // unique to at least one species descendant. One request is issued per
      // (species, parent) pair. A single call returns both strict-unique peptides for
      // the species AND peptides unique to the parent taxon, so per-taxon jobs for
      // higher-level taxa simultaneously feed both the shared-unique union and the
      // partial-coverage maps without redundant calls.
      if (core.length === 0 && !config.computePerTaxonUnique) {
        setStep('filter', { status: 'skipped', detail: 'Skipped — empty intersection' })
        status.value = 'done'
        return
      }

      const doShared = config.computeUniqueSharedPeptides
      const doPerTaxon = config.computePerTaxonUnique

      if (!doShared && !doPerTaxon) {
        setStep('filter', { status: 'skipped', detail: 'Both computations disabled' })
      } else {
        setStep('filter', { status: 'running', progress: null, detail: 'Computing…' })

        // Leaf classification: species and strain are leaf taxa (strict unique);
        // anything else is a higher-level taxon (partial coverage via unique_to_parent).
        // taxonRanks is populated from inputTaxa at the start of run().
        const isLeaf = (id: number): boolean => isLeafRank(taxonRanks.value[id])

        // uniquePerSpecies: strict-unique peptide set per species, populated at most
        // once per species regardless of how many parent-taxon jobs reference it.
        const uniquePerSpecies = new Map<number, Set<string>>()

        // coverage[parentTaxId][peptide] = list of species IDs whose unique_to_parent
        // contained this peptide (only for higher-level per-taxon taxa).
        const coverage: Record<number, Record<string, number[]>> = {}

        // Build the flat job list. Each job is [speciesId, parentId | undefined].
        // We deduplicate strictly: a (speciesId, parentId) job is added at most once.
        type Job = [speciesId: number, parentId: number | undefined]
        const jobs: Job[] = []
        const jobKeys = new Set<string>()
        const addJob = (speciesId: number, parentId?: number): void => {
          const key = `${speciesId}:${parentId ?? ''}`
          if (!jobKeys.has(key)) {
            jobKeys.add(key)
            jobs.push([speciesId, parentId])
          }
        }

        // Species covered by a higher-level parent job (their unique[] comes back in the
        // same response, so no extra parent-less call is needed for doShared).
        const coveredByHigherTaxon = new Set<number>()

        if (doPerTaxon) {
          for (const taxId of validTaxa) {
            if (isLeaf(taxId)) {
              // Leaf: call for taxId itself with no parent.
              addJob(taxId, undefined)
            } else {
              // Higher-level: one call per species descendant with this taxon as parent.
              coverage[taxId] = {}
              for (const speciesId of descendantsPerTaxon[taxId] ?? []) {
                coveredByHigherTaxon.add(speciesId)
                addJob(speciesId, taxId)
              }
            }
          }
        }

        if (doShared) {
          // Ensure every descendant species has its strict-unique peptides retrieved for
          // the shared-unique union. Parent-taxon jobs already return unique[] for covered
          // species, so only add parent-less jobs for the remainder.
          for (const speciesId of descendants) {
            if (!coveredByHigherTaxon.has(speciesId)) {
              addJob(speciesId, undefined)
            }
          }
        }

        const total = jobs.length
        let uDone = 0
        let uNextIdx = 0

        const uWorker = async (): Promise<void> => {
          let idx: number
          while ((idx = uNextIdx++) < total) {
            const [speciesId, parentId] = jobs[idx]!
            const { unique, uniqueToParent } = await taxonRepo.getUniquePeptides(
              speciesId, cleavageRegex, config.minLength, signal, parentId,
            )
            // Store strict-unique (parent-independent) at most once per species.
            if (!uniquePerSpecies.has(speciesId)) {
              uniquePerSpecies.set(speciesId, new Set(unique))
            }
            // Accumulate partial-coverage data when a parent was provided.
            if (parentId !== undefined && coverage[parentId] !== undefined) {
              const cov = coverage[parentId]!
              for (const pep of uniqueToParent) {
                if (cov[pep] === undefined) cov[pep] = []
                cov[pep]!.push(speciesId)
              }
            }
            uDone++
            setStep('filter', {
              progress: uDone / total,
              detail: fmtPercent(uDone, total),
            })
          }
        }

        const uWorkerCount = Math.min(config.parallelRequests, Math.max(total, 1))
        await Promise.all(Array.from({ length: uWorkerCount }, uWorker))

        if (doShared) {
          const uniqueUnion = unionSets(uniquePerSpecies.values())
          const unique = core.filter((p) => uniqueUnion.has(p)).sort()
          uniquePeptides.value = unique
          uniqueSharedPeptidesComputed.value = true
          addLog('info', `${fmtN(unique.length)} shared unique peptides after filter.`)
        }

        if (doPerTaxon) {

          const perTaxonResult: Record<number, string[]> = {}
          const perTaxonCoverageResult: Record<number, Record<string, number[]>> = {}
          for (const taxId of validTaxa) {
            if (isLeaf(taxId)) {
              const peps = [...(uniquePerSpecies.get(taxId) ?? [])].sort()
              perTaxonResult[taxId] = peps
              addLog('info', `${taxonNames.value[taxId] ?? taxId}: ${fmtN(peps.length)} unique peptides.`)
            } else {
              const cov = coverage[taxId] ?? {}
              const totalDescendants = (descendantsPerTaxon[taxId] ?? []).length
              // Sort by coverage count descending, then alphabetically.
              const peps = Object.keys(cov).sort((a, b) => {
                const diff = (cov[b]?.length ?? 0) - (cov[a]?.length ?? 0)
                return diff !== 0 ? diff : a.localeCompare(b)
              })
              perTaxonResult[taxId] = peps
              perTaxonCoverageResult[taxId] = cov
              addLog('info', `${taxonNames.value[taxId] ?? taxId}: ${fmtN(peps.length)} partially covering peptides (across ${fmtN(totalDescendants)} descendant species).`)
            }
          }
          perTaxonUniquePeptides.value = perTaxonResult
          perTaxonCoverage.value = perTaxonCoverageResult
          perTaxonUniqueComputed.value = true
        }

        const parts: string[] = []
        if (doShared) parts.push(`${fmtN(uniquePeptides.value.length)} shared unique`)
        if (doPerTaxon) parts.push('per-taxon computed')
        setStep('filter', { status: 'done', progress: 1, detail: parts.join('; ') })
      }
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
    }
  }

  function cancel() {
    abortController?.abort()
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
    cancel,
    reset,
    loadSaved,
  }
})
