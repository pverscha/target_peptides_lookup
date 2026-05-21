import { ref, watch } from 'vue'
import { usePipelineStore } from '@/stores/pipeline'
import { useConfigStore } from '@/stores/config'
import { saveAnalysis, listAnalyses, loadAnalysis, deleteAnalysis, renameAnalysis } from '@/services/HistoryService'
import type { AnalysisSummary } from '@/types'

export function useAnalysisHistory() {
  const pipeline = usePipelineStore()
  const config = useConfigStore()
  const history = ref<AnalysisSummary[]>([])
  const loading = ref(false)
  const saveError = ref<string | null>(null)

  async function refresh() {
    loading.value = true
    try {
      history.value = await listAnalyses()
    } finally {
      loading.value = false
    }
  }

  async function restore(id: number) {
    const snapshot = await loadAnalysis(id)
    if (!snapshot) return
    pipeline.loadSaved(snapshot)
  }

  async function remove(id: number) {
    await deleteAnalysis(id)
    history.value = history.value.filter((h) => h.id !== id)
  }

  async function rename(id: number, name: string) {
    await renameAnalysis(id, name)
    history.value = history.value.map((h) => h.id === id ? { ...h, name } : h)
  }

  watch(
    () => pipeline.status,
    async (newStatus) => {
      if (newStatus !== 'done' || pipeline.isRestoredSnapshot) return
      saveError.value = null
      try {
        // Deep-clone via JSON round-trip to strip Vue reactive proxies before
        // passing to IndexedDB's structured clone algorithm.
        const snapshot = JSON.parse(JSON.stringify({
          savedAt: new Date().toISOString(),
          inputTaxa: pipeline.inputTaxa,
          inputTaxonIds: pipeline.validTaxaIds,
          analysisConfig: {
            minLength: config.minLength,
            equateIL: config.equateIL,
            cleavageMethod: config.cleavageMethod,
            cleavageRegex: config.cleavageRegex,
            minProteins: config.minProteins,
            computePerTaxonUnique: config.computePerTaxonUnique,
            computeUniqueSharedPeptides: config.computeUniqueSharedPeptides,
          },
          taxonNames: pipeline.taxonNames,
          descendantIds: pipeline.descendantIds,
          descendantsByTaxon: pipeline.descendantsByTaxon,
          proteinCounts: pipeline.proteinCounts,
          intersectionPeptides: pipeline.intersectionPeptides,
          uniquePeptides: pipeline.uniquePeptides,
          perTaxonUniquePeptides: pipeline.perTaxonUniquePeptides,
          perTaxonCoreCounts: pipeline.perTaxonCoreCounts,
          lcaByPeptide: pipeline.lcaByPeptide,
          logs: pipeline.logs.map((l) => ({ ...l, timestamp: l.timestamp.toISOString() })),
        }))
        await saveAnalysis(snapshot)
        await refresh()
      } catch (err) {
        if (err instanceof DOMException && err.name === 'QuotaExceededError') {
          saveError.value = 'Storage quota exceeded. Delete older analyses to free space.'
        } else {
          saveError.value = err instanceof Error ? err.message : 'Failed to save analysis.'
        }
      }
    },
  )

  refresh()

  return { history, loading, saveError, refresh, restore, remove, rename }
}
