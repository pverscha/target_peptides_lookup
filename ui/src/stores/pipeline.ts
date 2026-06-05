import { defineStore } from 'pinia'
import { ref, readonly, computed } from 'vue'
import type { PipelineStep, PipelineStatus, LogEntry, AnalysisSnapshot, TaxonSuggestion } from '@/types'
import { useConfigStore } from './config'
import { UnipeptService } from '@/services/UnipeptService'
import { OpensearchService } from '@/services/OpensearchService'
import { TaxonRepository } from '@/repositories/TaxonRepository'
import { ProteinRepository } from '@/repositories/ProteinRepository'
import { digestProtein, filterUnique, intersectSets, TRYPSIN_RE } from '@/utils/peptides'
import { fmtN, formatLogLines } from '@/utils/format'
import { downloadText } from '@/utils/download'
import { isAbortError } from '@/utils/abort'

const LOG_UI_LIMIT = 100

const STEP_DEFS = [
  { id: 'validate',    label: 'Validate taxon IDs' },
  { id: 'descendants', label: 'Collect species-level descendants' },
  { id: 'count',       label: 'Count proteins per taxon' },
  { id: 'intersect',   label: 'Digest and intersect peptides' },
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
  // A single higher-rank taxon (e.g. a mammalian order) can contribute thousands of species.
  const descendantIds = ref<number[]>([])
  // Maps each input taxon ID to the list of its species-level descendants.
  // descendantIds is the deduplicated union of all these lists.
  const descendantsByTaxon = ref<Record<number, number[]>>({})
  // Number of proteins indexed in OpenSearch for each species-level descendant taxon.
  // Used to exclude taxa below the minimum protein threshold before intersection.
  const proteinCounts = ref<Record<number, number>>({})
  // The global core peptidome: peptides present in the intersection across ALL input taxa.
  // Computed by digesting every protein for every descendant species and intersecting the
  // resulting peptide sets up the taxon hierarchy.
  const intersectionPeptides = ref<string[]>([])
  // Subset of intersectionPeptides that are unique to the input taxon group: their LCA
  // lineage (according to pept2taxa) does not include any taxon outside the input set.
  const uniquePeptides = ref<string[]>([])
  // Per-taxon unique peptides: for each input taxon, the peptides from its own per-taxon
  // core (intersection across its descendants only) whose LCA lineage falls within that
  // single taxon. Populated only when computePerTaxonUnique is enabled.
  const perTaxonUniquePeptides = ref<Record<number, string[]>>({})
  // Number of peptides in each input taxon's per-taxon core before the uniqueness filter.
  // Useful for understanding how much of the per-taxon core survives filtering.
  const perTaxonCoreCounts = ref<Record<number, number>>({})
  // LCA metadata for every peptide that was submitted to pept2lca. Keyed by peptide
  // sequence; covers both intersectionPeptides and per-taxon core peptides (when enabled).
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
    proteinCounts.value = {}
    intersectionPeptides.value = []
    uniquePeptides.value = []
    perTaxonUniquePeptides.value = {}
    perTaxonCoreCounts.value = {}
    lcaByPeptide.value = {}
    perTaxonUniqueComputed.value = false
    uniqueSharedPeptidesComputed.value = false
    steps.value = makeSteps()
  }

  async function run(taxa: TaxonSuggestion[]) {
    if (status.value === 'running') return

    _restoredFromHistory.value = false
    resetState()
    inputTaxa.value = taxa
    const inputTaxaIds = taxa.map((t) => t.id)
    abortController = new AbortController()
    const signal = abortController.signal
    status.value = 'running'

    const taxonRepo = new TaxonRepository(new UnipeptService({
      unipeptUrl: config.unipeptUrl,
      batchSize: config.batchSize,
      lcaBatchSize: config.lcaBatchSize,
      taxaBatchSize: config.taxaBatchSize,
      parallelRequests: config.parallelRequests,
      equateIL: config.equateIL,
    }))
    const proteinRepo = new ProteinRepository(new OpensearchService({
      opensearchUrl: config.opensearchUrl,
      opensearchIndex: config.opensearchIndex,
    }))

    try {
      // ── Step 1: Validate ────────────────────────────────────────────────────
      // Sends the user-supplied taxon IDs to Unipept's taxonomy API in batches.
      // IDs that are not present in the NCBI taxonomy are flagged as warnings and
      // excluded from all subsequent steps. The validated IDs and their display
      // names are stored so later steps can resolve taxon IDs to human-readable names.
      setStep('validate', { status: 'running', progress: null, detail: `Checking ${fmtN(inputTaxaIds.length)} IDs…` })
      const { valid, invalid, names } = await taxonRepo.validate(
        inputTaxaIds, signal,
        (done, total) => setStep('validate', { progress: done / total, detail: `Batch ${fmtN(done)}/${fmtN(total)}` }),
      )
      for (const id of invalid) addLog('warning', `Unknown taxon ID: ${id}`)
      if (valid.length === 0) throw new Error('None of the provided taxon IDs are known to Unipept.')
      validTaxaIds.value = valid
      taxonNames.value = names
      setStep('validate', { status: 'done', progress: 1, detail: `${fmtN(valid.length)}/${fmtN(inputTaxaIds.length)} valid` })

      // ── Step 2: Descendants ─────────────────────────────────────────────────
      // Expands each validated input taxon to all of its species-level descendants
      // using Unipept's taxonomy API. Higher-rank taxa (genera, families, orders, …)
      // are not used directly for protein lookup; only species are queried against
      // OpenSearch in later steps. The flat list (descendants) is the deduplicated
      // union across all input taxa; byTaxon keeps the per-taxon mapping so the
      // intersection step can group species back to their parent input taxon.
      setStep('descendants', { status: 'running', progress: null, detail: 'Fetching…' })
      const { descendants, byTaxon, warnings: descWarnings } = await taxonRepo.getDescendants(
        valid, signal,
        (done, total) => setStep('descendants', { progress: done / total, detail: `Batch ${fmtN(done)}/${fmtN(total)}` }),
      )
      for (const w of descWarnings) addLog('warning', w)
      if (descendants.length === 0) throw new Error('No species-level descendants found for any input taxon.')
      descendantIds.value = descendants
      descendantsByTaxon.value = byTaxon
      setStep('descendants', { status: 'done', progress: 1, detail: `${fmtN(descendants.length)} species` })
      addLog('info', `Collected ${fmtN(descendants.length)} unique species-level descendants.`)

      // ── Step 3: Count proteins ──────────────────────────────────────────────
      // Issues aggregation queries to OpenSearch to count how many proteins are
      // indexed for each species-level descendant. Species below the configured
      // minimum protein threshold (config.minProteins) are excluded from the
      // intersection step; they are too sparsely represented to produce meaningful
      // shared peptides and would collapse the intersection to empty.
      // `populated` is the set of species that pass this threshold.
      setStep('count', { status: 'running', progress: null, detail: 'Querying aggregations…' })
      const counts = await proteinRepo.countByTaxon(
        descendants, signal,
        (done, total) => setStep('count', { progress: done / total, detail: `${fmtN(done)}/${fmtN(total)} chunks` }),
      )
      proteinCounts.value = counts
      const populated = new Set(descendants.filter((t) => (counts[t] ?? 0) >= config.minProteins))
      const excluded = descendants.filter((t) => (counts[t] ?? 0) < config.minProteins)
      for (const t of excluded) addLog('warning', `Excluded from intersection (fewer than ${config.minProteins} protein(s) in OpenSearch): ${t}`)
      if (excluded.length > 0) addLog('info', `${fmtN(excluded.length)} of ${fmtN(descendants.length)} descendant taxa excluded (below minimum protein threshold).`)
      if (populated.size === 0) throw new Error('No descendant taxa meet the minimum protein threshold.')
      setStep('count', { status: 'done', progress: 1, detail: `${fmtN(populated.size)} taxa with proteins` })



      // ── Step 4: Intersect ───────────────────────────────────────────────────
      // This is the most compute- and memory-intensive step. For each input taxon,
      // proteins are streamed from OpenSearch and digested in silico into peptides.
      // Two levels of intersection are maintained simultaneously:
      //
      //   taxonIntersection — running intersection of peptide sets across the
      //     species descendants of one input taxon. Starts as the first species'
      //     full peptide set and shrinks with each additional species. Represents
      //     the "per-taxon core": peptides shared by every species under that taxon.
      //     Species are processed in ascending protein-count order so the smallest
      //     (most restrictive) sets prune the intersection early.
      //
      //   taxonUnion — union of all species peptides (for a given input taxon)
      //     that are already in the current globalCore candidate. This acts as a
      //     filter: only peptides that could still survive the global intersection
      //     are accumulated, keeping this set much smaller than a full union.
      //
      //   globalCore — running intersection across all input taxa of their
      //     respective taxonUnions. After all taxa are processed this holds the
      //     global core peptidome: peptides present in every input taxon group.
      //
      //   corePerTaxon — the final taxonIntersection for each input taxon, kept
      //     alive until Step 6 for per-taxon unique peptide computation.
      //
      // Note: speciesPeps is the largest transient allocation — it holds every
      // distinct digested peptide from one species and is GC'd after the
      // intersection for that species is computed.
      setStep('intersect', { status: 'running', progress: null, detail: 'Starting…' })
      const totalProteins = [...populated].reduce((s, t) => s + (counts[t] ?? 0), 0)
      let processed = 0

      const cleavageRe =
        config.cleavageMethod === 'tryptic'
          ? TRYPSIN_RE
          : new RegExp(config.cleavageRegex, 'g')

      // Holds the per-taxon core peptide set for each input taxon.
      // All entries remain live until perTaxonTask in Step 6 consumes them.
      const corePerTaxon = new Map<number, Set<string>>()
      let globalCore: Set<string> | null = null

      for (const taxId of valid) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

        // Sort by ascending protein count so the smallest (most restrictive)
        // species is processed first, pruning taxonIntersection early.
        const taxDescendants = (byTaxon[taxId] ?? [])
          .filter((d) => populated.has(d))
          .sort((a, b) => (counts[a] ?? 0) - (counts[b] ?? 0))

        // Running intersection across this taxon's descendants.
        // null = not yet initialised (first species sets it).
        let taxonIntersection: Set<string> | null = null
        // Union of peptides from this taxon's descendants that survive the current
        // globalCore filter. Used to update globalCore after all descendants are processed.
        const taxonUnion = new Set<string>()
        // Guard flag: once the intersection empties we stop updating it but still
        // need to continue iterating to populate taxonUnion for globalCore.
        let intersectionEmptied = false

        for (const descId of taxDescendants) {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
          // All unique peptides produced by digesting this species' proteins.
          // Peak allocation: can reach hundreds of thousands of entries for
          // protein-rich species. GC-eligible once intersectSets returns below.
          const speciesPeps = new Set<string>()

          for await (const seq of proteinRepo.streamSequences(descId, signal)) {
            digestProtein(seq, config.equateIL, config.minLength, speciesPeps, cleavageRe)
            processed++
            if (processed % 200 === 0) {
              setStep('intersect', {
                progress: processed / totalProteins,
                detail: `${fmtN(processed)}/${fmtN(totalProteins)} proteins (taxon ${taxId})`,
              })
            }
          }

          if (!intersectionEmptied) {
            taxonIntersection = taxonIntersection === null ? speciesPeps : intersectSets(taxonIntersection, speciesPeps)
            if (taxonIntersection.size === 0) {
              addLog('warning', `Running intersection became empty for taxon ${taxId} after processing ${descId}.`)
              intersectionEmptied = true
            }
          }

          // Only add peptides that are already candidates for globalCore.
          // This avoids accumulating the full per-species union, which would be
          // much larger and would not affect the final result.
          for (const p of speciesPeps) {
            if (globalCore === null || globalCore.has(p)) taxonUnion.add(p)
          }
        }

        corePerTaxon.set(taxId, taxonIntersection ?? new Set())

        globalCore = globalCore === null ? taxonUnion : intersectSets(globalCore, taxonUnion)

        if (globalCore.size === 0) {
          addLog('warning', `Global intersection became empty after processing taxon ${taxId}.`)
          break
        }
      }

      const core = [...(globalCore ?? new Set())]
      intersectionPeptides.value = core
      setStep('intersect', {
        status: 'done',
        progress: 1,
        detail: core.length === 0 ? 'No shared peptides' : `${fmtN(core.length)} shared peptides`,
      })
      addLog('info', `Global core peptidome size: ${fmtN(core.length)}`)
      const coreCounts: Record<number, number> = {}
      for (const [tId, perCore] of corePerTaxon) {
        coreCounts[tId] = perCore.size
        addLog('info', `Per-taxon core for ${names[tId] ?? tId}: ${fmtN(perCore.size)} peptides`)
      }
      perTaxonCoreCounts.value = coreCounts

      // Build the union of all peptides that need LCA resolution. The global core
      // always needs LCA lookup. Per-taxon cores add extra peptides only when
      // per-taxon unique peptide computation is enabled, because per-taxon cores
      // are typically larger than (and not a subset of) the global core.
      const allPeptidesForLca = new Set(core)
      if (config.computePerTaxonUnique) {
        for (const perCore of corePerTaxon.values()) {
          for (const p of perCore) allPeptidesForLca.add(p)
        }
      }

      if (allPeptidesForLca.size === 0) {
        addLog('info', 'No peptides to look up — nothing to report.')
        for (const id of ['lca', 'filter'] as StepId[]) {
          setStep(id, { status: 'skipped', detail: 'Skipped — empty intersection' })
        }
        status.value = 'done'
        return
      }

      // ── Step 5: LCA lookup ──────────────────────────────────────────────────
      // Queries Unipept's pept2lca endpoint for every candidate peptide. Two
      // data structures are returned:
      //
      //   lineageByPeptide — maps each peptide to the set of all NCBI taxon IDs
      //     in its full lineage (from domain down to species). Used in Step 6 to
      //     determine whether a peptide is unique to the input taxon group without
      //     a second network call. Held live until filterUnique returns in Step 6.
      //
      //   lcaMap — maps each peptide to its direct LCA (id, name, rank). This is
      //     a compact subset of lineageByPeptide and is persisted in the store as
      //     lcaByPeptide for display in the results panel.
      const lcaPeptides = [...allPeptidesForLca]
      setStep('lca', { status: 'running', progress: null, detail: 'Querying Unipept pept2lca…' })
      const { lineageByPeptide, lcaByPeptide: lcaMap } = await taxonRepo.getLcas(
        lcaPeptides, signal,
        (done, total) => {
          const peptidesDone = Math.min(done * config.lcaBatchSize, lcaPeptides.length)
          const pct = ((done / total) * 100).toFixed(1)
          setStep('lca', { progress: done / total, detail: `${fmtN(peptidesDone)}/${fmtN(lcaPeptides.length)} peptides (${pct}%)` })
        },
      )
      const missing = lcaPeptides.filter((p) => !lineageByPeptide.has(p))
      for (const p of missing) addLog('warning', `No LCA returned for peptide: ${p}`)
      lcaByPeptide.value = Object.fromEntries(lcaMap)
      setStep('lca', { status: 'done', progress: 1, detail: `${fmtN(lineageByPeptide.size)} LCAs retrieved` })

      // ── Step 6: Filter ──────────────────────────────────────────────────────
      // Applies the uniqueness filter to remove peptides that are not exclusive
      // to the input taxon group. Two modes are supported and can run concurrently:
      //
      //   globalTask — queries Unipept's pept2taxa endpoint for every peptide in
      //     the global core. A peptide is considered unique if every organism that
      //     contains it falls within the input taxon set (i.e. no hit outside the
      //     group). This is a network-bound operation.
      //
      //   perTaxonTask — for each input taxon, filters its per-taxon core using
      //     the lineageByPeptide map from Step 5 (no additional network calls).
      //     A peptide is unique to a taxon if the taxon's ID appears somewhere in
      //     the peptide's LCA lineage. This is CPU-bound and runs synchronously
      //     via filterUnique. Note: this single-taxon check is an approximation;
      //     the global uniqueness check (pept2taxa) is more accurate for multi-
      //     taxon input sets.
      //
      // Both tasks are launched with Promise.all so the network I/O and CPU work
      // overlap. lineageByPeptide (from Step 5) is consumed here and becomes
      // eligible for GC once perTaxonTask resolves.
      const doGlobal = config.computeUniqueSharedPeptides
      const doPerTaxon = config.computePerTaxonUnique

      if (!doGlobal && !doPerTaxon) {
        setStep('filter', { status: 'skipped', detail: 'Both computations disabled' })
      } else {
        setStep('filter', { status: 'running', progress: null, detail: 'Computing…' })
        const inputSet = new Set(valid)

        const globalTask = doGlobal
          ? taxonRepo.getUniquePeptides(
              core, inputSet, signal,
              (done, total) => {
                const peptidesDone = Math.min(done * config.taxaBatchSize, core.length)
                const pct = ((done / total) * 100).toFixed(1)
                setStep('filter', { progress: done / total, detail: `pept2taxa: ${fmtN(peptidesDone)}/${fmtN(core.length)} peptides (${pct}%)` })
              },
            )
          : Promise.resolve(new Set<string>())

        const perTaxonTask = doPerTaxon
          ? Promise.resolve(Object.fromEntries(
              [...corePerTaxon.entries()].map(([tId, perCore]) => [
                tId,
                filterUnique([...perCore], lineageByPeptide, new Set([tId])),
              ]),
            ) as Record<number, string[]>)
          : Promise.resolve({} as Record<number, string[]>)

        const [uniqueSet, perTaxonResult] = await Promise.all([globalTask, perTaxonTask])

        if (doGlobal) {
          const unique = [...uniqueSet].sort()
          uniquePeptides.value = unique
          uniqueSharedPeptidesComputed.value = true
          addLog('info', `${fmtN(unique.length)} shared unique peptides after filter.`)
        }

        if (doPerTaxon) {
          perTaxonUniqueComputed.value = true
          for (const [tId, peps] of Object.entries(perTaxonResult)) {
            addLog('info', `${names[Number(tId)] ?? tId}: ${fmtN(peps.length)} unique peptides.`)
          }
        }
        perTaxonUniquePeptides.value = perTaxonResult

        const parts: string[] = []
        if (doGlobal) parts.push(`${fmtN(uniquePeptides.value.length)} shared unique`)
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
    proteinCounts.value = snapshot.proteinCounts
    intersectionPeptides.value = snapshot.intersectionPeptides
    uniquePeptides.value = snapshot.uniquePeptides
    perTaxonUniquePeptides.value = snapshot.perTaxonUniquePeptides
    perTaxonCoreCounts.value = snapshot.perTaxonCoreCounts
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
    proteinCounts: readonly(proteinCounts),
    intersectionPeptides: readonly(intersectionPeptides),
    uniquePeptides: readonly(uniquePeptides),
    perTaxonUniquePeptides: readonly(perTaxonUniquePeptides),
    perTaxonCoreCounts: readonly(perTaxonCoreCounts),
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
