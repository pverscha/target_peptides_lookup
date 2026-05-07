import { defineStore } from 'pinia'
import { ref, readonly } from 'vue'
import type { PipelineStep, PipelineStatus, LogEntry } from '@/types'
import { useConfigStore } from './config'
import { UnipeptService } from '@/services/UnipeptService'
import { OpensearchService } from '@/services/OpensearchService'
import { TaxonRepository } from '@/repositories/TaxonRepository'
import { ProteinRepository } from '@/repositories/ProteinRepository'
import { digestProtein, filterUnique, intersectSets, TRYPSIN_RE } from '@/utils/peptides'
import { fmtN } from '@/utils/format'

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
  const logs = ref<LogEntry[]>([])

  const validTaxaIds = ref<number[]>([])
  const taxonNames = ref<Record<number, string>>({})
  const descendantIds = ref<number[]>([])
  const descendantsByTaxon = ref<Record<number, number[]>>({})
  const proteinCounts = ref<Record<number, number>>({})
  const intersectionPeptides = ref<string[]>([])
  const uniquePeptides = ref<string[]>([])
  const perTaxonUniquePeptides = ref<Record<number, string[]>>({})
  const perTaxonCoreCounts = ref<Record<number, number>>({})
  const lcaByPeptide = ref<Record<string, { id: number; name: string; rank: string }>>({})

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
    taxonNames.value = {}
    descendantIds.value = []
    descendantsByTaxon.value = {}
    proteinCounts.value = {}
    intersectionPeptides.value = []
    uniquePeptides.value = []
    perTaxonUniquePeptides.value = {}
    perTaxonCoreCounts.value = {}
    lcaByPeptide.value = {}
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
      parallelRequests: config.parallelRequests,
      equateIL: config.equateIL,
    }))
    const proteinRepo = new ProteinRepository(new OpensearchService({
      opensearchUrl: config.opensearchUrl,
      opensearchIndex: config.opensearchIndex,
    }))

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

      // ── Step 3: Count proteins ──────────────────────────────────────────────
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
      setStep('intersect', { status: 'running', progress: null, detail: 'Starting…' })
      const totalProteins = [...populated].reduce((s, t) => s + (counts[t] ?? 0), 0)
      let processed = 0

      const cleavageRe =
        config.cleavageMethod === 'tryptic'
          ? TRYPSIN_RE
          : new RegExp(config.cleavageRegex, 'g')

      const corePerTaxon = new Map<number, Set<string>>()
      let globalCore: Set<string> | null = null

      for (const taxId of valid) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

        const taxDescendants = (byTaxon[taxId] ?? [])
          .filter((d) => populated.has(d))
          .sort((a, b) => (counts[a] ?? 0) - (counts[b] ?? 0))

        let taxonIntersection: Set<string> | null = null
        const taxonUnion = new Set<string>()
        let intersectionEmptied = false

        for (const descId of taxDescendants) {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
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

          for (const p of speciesPeps) taxonUnion.add(p)
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

      // Collect all peptides needing LCA lookup
      const allPeptidesForLca = new Set(core)
      for (const perCore of corePerTaxon.values()) {
        for (const p of perCore) allPeptidesForLca.add(p)
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
      const lcaPeptides = [...allPeptidesForLca]
      setStep('lca', { status: 'running', progress: null, detail: 'Querying Unipept pept2lca…' })
      const { lineageByPeptide, lcaByPeptide: lcaMap } = await taxonRepo.getLcas(
        lcaPeptides, signal,
        (done, total) => {
          const peptidesDone = Math.min(done * config.batchSize, lcaPeptides.length)
          const pct = ((done / total) * 100).toFixed(1)
          setStep('lca', { progress: done / total, detail: `${fmtN(peptidesDone)}/${fmtN(lcaPeptides.length)} peptides (${pct}%)` })
        },
      )
      const missing = lcaPeptides.filter((p) => !lineageByPeptide.has(p))
      for (const p of missing) addLog('warning', `No LCA returned for peptide: ${p}`)
      lcaByPeptide.value = Object.fromEntries(lcaMap)
      setStep('lca', { status: 'done', progress: 1, detail: `${fmtN(lineageByPeptide.size)} LCAs retrieved` })

      // ── Step 6: Filter ──────────────────────────────────────────────────────
      setStep('filter', { status: 'running', progress: null, detail: 'Filtering…' })
      const inputSet = new Set(valid)

      // Shared unique peptides (global core filtered against all input taxa)
      const unique = filterUnique(core, lineageByPeptide, inputSet)
      uniquePeptides.value = unique

      // Per-taxon unique peptides (per-taxon core filtered against that taxon only)
      const perTaxonResult: Record<number, string[]> = {}
      for (const [tId, perCore] of corePerTaxon) {
        perTaxonResult[tId] = filterUnique([...perCore], lineageByPeptide, new Set([tId]))
      }
      perTaxonUniquePeptides.value = perTaxonResult

      setStep('filter', { status: 'done', progress: 1, detail: `${fmtN(unique.length)} shared unique; per-taxon computed` })
      addLog('info', `${fmtN(unique.length)} shared unique peptides after filter.`)
      for (const [tId, peps] of Object.entries(perTaxonResult)) {
        addLog('info', `${names[Number(tId)] ?? tId}: ${fmtN(peps.length)} unique peptides.`)
      }
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
    taxonNames: readonly(taxonNames),
    descendantIds: readonly(descendantIds),
    descendantsByTaxon: readonly(descendantsByTaxon),
    proteinCounts: readonly(proteinCounts),
    intersectionPeptides: readonly(intersectionPeptides),
    uniquePeptides: readonly(uniquePeptides),
    perTaxonUniquePeptides: readonly(perTaxonUniquePeptides),
    perTaxonCoreCounts: readonly(perTaxonCoreCounts),
    lcaByPeptide: readonly(lcaByPeptide),
    run,
    cancel,
    reset,
  }
})
