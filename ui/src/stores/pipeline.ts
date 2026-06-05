import { defineStore } from 'pinia'
import { ref, readonly, computed } from 'vue'
import type { PipelineStep, PipelineStatus, LogEntry, AnalysisSnapshot, TaxonSuggestion } from '@/types'
import { useConfigStore } from './config'
import { UnipeptService } from '@/services/UnipeptService'
import { TaxonRepository } from '@/repositories/TaxonRepository'
import { chunked, intersectSets, unionSets } from '@/utils/peptides'
import { fmtN, formatLogLines } from '@/utils/format'
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
  // are globally unique to at least one species descendant of that taxon.
  const perTaxonUniquePeptides = ref<Record<number, string[]>>({})
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
      parallelRequests: config.parallelRequests,
      equateIL: config.equateIL,
    }))

    const cleavageRegex = config.cleavageMethod === 'tryptic' ? '[KR](?!P)' : config.cleavageRegex

    try {
      // ── Step 1: Validate ────────────────────────────────────────────────────
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

      // ── Step 3: Compute shared peptides ─────────────────────────────────────
      // Sends species-level descendant IDs in batches of SHARED_PEPTIDES_BATCH_SIZE
      // to the shared_peptides endpoint. The server digests proteins and computes the
      // peptide intersection. The batch results are intersected client-side to obtain
      // the global core peptidome. This is mathematically equivalent to a single call
      // with all IDs because shared(A ∪ B) = shared(A) ∩ shared(B).
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
            detail: `Batch ${fmtN(batchesDone)}/${fmtN(batches.length)}`,
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
      addLog('info', `Global core peptidome size: ${fmtN(core.length)}`)

      if (core.length === 0) {
        addLog('info', 'No peptides to look up — nothing to report.')
        for (const id of ['lca', 'filter'] as StepId[]) {
          setStep(id, { status: 'skipped', detail: 'Skipped — empty intersection' })
        }
        status.value = 'done'
        return
      }

      // ── Step 4: LCA lookup ──────────────────────────────────────────────────
      setStep('lca', { status: 'running', progress: null, detail: 'Querying Unipept pept2lca…' })
      const { lcaByPeptide: lcaMap } = await taxonRepo.getLcas(
        core, signal,
        (done, total) => {
          const peptidesDone = Math.min(done * config.lcaBatchSize, core.length)
          const pct = ((done / total) * 100).toFixed(1)
          setStep('lca', { progress: done / total, detail: `${fmtN(peptidesDone)}/${fmtN(core.length)} peptides (${pct}%)` })
        },
      )
      const missing = core.filter((p) => !lcaMap.has(p))
      for (const p of missing) addLog('warning', `No LCA returned for peptide: ${p}`)
      lcaByPeptide.value = Object.fromEntries(lcaMap)
      setStep('lca', { status: 'done', progress: 1, detail: `${fmtN(lcaMap.size)} LCAs retrieved` })

      // ── Step 5: Uniqueness filter ───────────────────────────────────────────
      // Uses the unique_peptides endpoint to determine which peptides are globally
      // unique to at least one species descendant. One request is issued per species,
      // parallelised via a worker pool. The results are shared between the global
      // unique computation (union across all species) and the per-taxon computation
      // (union across each taxon's own descendants), avoiding redundant API calls.
      const doGlobal = config.computeUniqueSharedPeptides
      const doPerTaxon = config.computePerTaxonUnique

      if (!doGlobal && !doPerTaxon) {
        setStep('filter', { status: 'skipped', detail: 'Both computations disabled' })
      } else {
        setStep('filter', { status: 'running', progress: null, detail: 'Computing…' })

        const uniquePerSpecies = new Map<number, Set<string>>()
        let uDone = 0
        let uNextIdx = 0

        const uWorker = async (): Promise<void> => {
          let idx: number
          while ((idx = uNextIdx++) < descendants.length) {
            const speciesId = descendants[idx]!
            const peps = await taxonRepo.getUniquePeptides(speciesId, cleavageRegex, config.minLength, signal)
            uniquePerSpecies.set(speciesId, new Set(peps))
            uDone++
            setStep('filter', {
              progress: uDone / descendants.length,
              detail: `${fmtN(uDone)}/${fmtN(descendants.length)} species`,
            })
          }
        }

        const uWorkerCount = Math.min(config.parallelRequests, descendants.length)
        await Promise.all(Array.from({ length: uWorkerCount }, uWorker))

        if (doGlobal) {
          const uniqueUnion = unionSets(uniquePerSpecies.values())
          const unique = core.filter((p) => uniqueUnion.has(p)).sort()
          uniquePeptides.value = unique
          uniqueSharedPeptidesComputed.value = true
          addLog('info', `${fmtN(unique.length)} shared unique peptides after filter.`)
        }

        if (doPerTaxon) {
          const perTaxonResult: Record<number, string[]> = {}
          for (const taxId of valid) {
            const taxSpecies = byTaxon[taxId] ?? []
            const taxSets = taxSpecies.map(sid => uniquePerSpecies.get(sid)).filter((s): s is Set<string> => !!s)
            const taxUnique = unionSets(taxSets)
            const taxPeptides = core.filter((p) => taxUnique.has(p)).sort()
            perTaxonResult[taxId] = taxPeptides
            addLog('info', `${names[taxId] ?? taxId}: ${fmtN(taxPeptides.length)} unique peptides.`)
          }
          perTaxonUniquePeptides.value = perTaxonResult
          perTaxonUniqueComputed.value = true
        }

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
    intersectionPeptides.value = snapshot.intersectionPeptides
    uniquePeptides.value = snapshot.uniquePeptides
    perTaxonUniquePeptides.value = snapshot.perTaxonUniquePeptides
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
