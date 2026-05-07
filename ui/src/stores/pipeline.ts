import { defineStore } from 'pinia'
import { ref, readonly } from 'vue'
import type { PipelineStep, PipelineStatus, LogEntry } from '@/types'
import { useConfigStore } from './config'
import { UnipeptService } from '@/services/UnipeptService'
import { OpensearchService } from '@/services/OpensearchService'
import { TaxonRepository } from '@/repositories/TaxonRepository'
import { ProteinRepository } from '@/repositories/ProteinRepository'
import { digestProtein, filterUnique, intersectSets } from '@/utils/peptides'

const STEP_DEFS = [
  { id: 'validate',    label: 'Validate taxon IDs' },
  { id: 'descendants', label: 'Collect species descendants' },
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
  const logs = ref<LogEntry[]>([])

  const validTaxaIds = ref<number[]>([])
  const descendantIds = ref<number[]>([])
  const proteinCounts = ref<Record<number, number>>({})
  const intersectionPeptides = ref<string[]>([])
  const uniquePeptides = ref<string[]>([])

  let abortController: AbortController | null = null

  function setStep(id: StepId, patch: Partial<PipelineStep>) {
    steps.value = steps.value.map((s) => (s.id === id ? { ...s, ...patch } : s))
  }

  function addLog(level: LogEntry['level'], message: string) {
    logs.value.push({ level, message, timestamp: new Date() })
  }

  function resetState() {
    logs.value = []
    validTaxaIds.value = []
    descendantIds.value = []
    proteinCounts.value = {}
    intersectionPeptides.value = []
    uniquePeptides.value = []
    steps.value = makeSteps()
  }

  async function run(inputTaxaIds: number[]) {
    if (status.value === 'running') return

    resetState()
    abortController = new AbortController()
    const signal = abortController.signal
    status.value = 'running'

    const taxonRepo = new TaxonRepository(new UnipeptService({
      unipeptUrl: config.unipeptUrl,
      batchSize: config.batchSize,
      equateIL: config.equateIL,
    }))
    const proteinRepo = new ProteinRepository(new OpensearchService({
      opensearchUrl: config.opensearchUrl,
      opensearchIndex: config.opensearchIndex,
    }))

    try {
      // ── Step 1: Validate ────────────────────────────────────────────────────
      setStep('validate', { status: 'running', progress: null, detail: `Checking ${inputTaxaIds.length} IDs…` })
      const { valid, invalid } = await taxonRepo.validate(
        inputTaxaIds, signal,
        (done, total) => setStep('validate', { progress: done / total, detail: `Batch ${done}/${total}` }),
      )
      for (const id of invalid) addLog('warning', `Unknown taxon ID: ${id}`)
      if (valid.length === 0) throw new Error('None of the provided taxon IDs are known to Unipept.')
      validTaxaIds.value = valid
      setStep('validate', { status: 'done', progress: 1, detail: `${valid.length}/${inputTaxaIds.length} valid` })

      // ── Step 2: Descendants ─────────────────────────────────────────────────
      setStep('descendants', { status: 'running', progress: null, detail: 'Fetching…' })
      const { descendants, warnings: descWarnings } = await taxonRepo.getDescendants(
        valid, signal,
        (done, total) => setStep('descendants', { progress: done / total, detail: `Batch ${done}/${total}` }),
      )
      for (const w of descWarnings) addLog('warning', w)
      if (descendants.length === 0) throw new Error('No species-level descendants found for any input taxon.')
      descendantIds.value = descendants
      setStep('descendants', { status: 'done', progress: 1, detail: `${descendants.length} species` })
      addLog('info', `Collected ${descendants.length} unique species-level descendants.`)

      // ── Step 3: Count proteins ──────────────────────────────────────────────
      setStep('count', { status: 'running', progress: null, detail: 'Querying aggregations…' })
      const counts = await proteinRepo.countByTaxon(
        descendants, signal,
        (done, total) => setStep('count', { progress: done / total, detail: `${done}/${total} chunks` }),
      )
      proteinCounts.value = counts
      const populated = descendants.filter((t) => (counts[t] ?? 0) > 0)
      const empty = descendants.filter((t) => !(counts[t] ?? 0))
      for (const t of empty) addLog('warning', `Excluded from intersection (no proteins in OpenSearch): ${t}`)
      if (empty.length > 0) addLog('info', `${empty.length} of ${descendants.length} descendant taxa excluded (no proteins).`)
      if (populated.length === 0) throw new Error('No descendant taxa have proteins in OpenSearch.')
      setStep('count', { status: 'done', progress: 1, detail: `${populated.length} taxa with proteins` })

      // ── Step 4: Intersect ───────────────────────────────────────────────────
      setStep('intersect', { status: 'running', progress: null, detail: 'Starting…' })
      const totalProteins = populated.reduce((s, t) => s + (counts[t] ?? 0), 0)
      let processed = 0
      const sortedTaxa = [...populated].sort((a, b) => (counts[a] ?? 0) - (counts[b] ?? 0))
      let candidate: Set<string> | null = null
      let earlyExit = false

      for (const taxId of sortedTaxa) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        const taxPeptides = new Set<string>()

        for await (const seq of proteinRepo.streamSequences(taxId, signal)) {
          digestProtein(seq, config.equateIL, config.minLength, taxPeptides)
          processed++
          if (processed % 200 === 0) {
            setStep('intersect', {
              progress: processed / totalProteins,
              detail: `${processed.toLocaleString()}/${totalProteins.toLocaleString()} proteins (taxon ${taxId})`,
            })
          }
        }

        candidate = candidate === null ? taxPeptides : intersectSets(candidate, taxPeptides)

        if (candidate.size === 0) {
          addLog('warning', `Running intersection became empty after taxon ${taxId}; stopping early.`)
          earlyExit = true
          break
        }
      }

      const core = candidate ? [...candidate] : []
      intersectionPeptides.value = core
      setStep('intersect', {
        status: 'done',
        progress: 1,
        detail: earlyExit ? 'No shared peptides' : `${core.length.toLocaleString()} shared peptides`,
      })
      addLog('info', `Core peptidome size (intersection across organisms): ${core.length}`)

      if (core.length === 0) {
        addLog('info', 'No peptides shared across all organisms — nothing to report.')
        for (const id of ['lca', 'filter'] as StepId[]) {
          setStep(id, { status: 'skipped', detail: 'Skipped — empty intersection' })
        }
        status.value = 'done'
        return
      }

      // ── Step 5: LCA lookup ──────────────────────────────────────────────────
      setStep('lca', { status: 'running', progress: null, detail: 'Querying Unipept pept2lca…' })
      const lineageByPeptide = await taxonRepo.getLcas(
        core, signal,
        (done, total) => setStep('lca', { progress: done / total, detail: `Batch ${done}/${total}` }),
      )
      const missing = core.filter((p) => !lineageByPeptide.has(p))
      for (const p of missing) addLog('warning', `No LCA returned for peptide: ${p}`)
      setStep('lca', { status: 'done', progress: 1, detail: `${lineageByPeptide.size} LCAs retrieved` })

      // ── Step 6: Filter ──────────────────────────────────────────────────────
      setStep('filter', { status: 'running', progress: null, detail: 'Filtering…' })
      const inputSet = new Set(valid)
      const unique = filterUnique(core, lineageByPeptide, inputSet)
      uniquePeptides.value = unique
      setStep('filter', { status: 'done', progress: 1, detail: `${unique.length} unique peptides` })
      addLog('info', `${unique.length} peptides remain after uniqueness filter.`)
      status.value = 'done'

    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
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
    resetState()
    status.value = 'idle'
  }

  return {
    status: readonly(status),
    steps: readonly(steps),
    logs: readonly(logs),
    validTaxaIds: readonly(validTaxaIds),
    descendantIds: readonly(descendantIds),
    proteinCounts: readonly(proteinCounts),
    intersectionPeptides: readonly(intersectionPeptides),
    uniquePeptides: readonly(uniquePeptides),
    run,
    cancel,
    reset,
  }
})
