import { defineStore } from 'pinia'
import { ref, watch, computed } from 'vue'
import type { Config, AnalysisParams } from '@/types'

const STORAGE_KEY = 'tpi_config'

const DEFAULTS: Config = {
  unipeptUrl: 'https://api.unipept.ugent.be',
  opensearchUrl: 'http://patty.taild1497.ts.net:9200',
  opensearchIndex: 'uniprot_entries',
  batchSize: 1000,
  lcaBatchSize: 1000,
  taxaBatchSize: 50,
  parallelRequests: 5,
  minLength: 6,
  equateIL: true,
  cleavageMethod: 'tryptic',
  cleavageRegex: '(?<=[KR])(?!P)',
  minProteins: 1,
  computePerTaxonUnique: true,
  computeUniqueSharedPeptides: true,
}

function loadStored(): Config {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Config>) } : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

export const useConfigStore = defineStore('config', () => {
  const initial = loadStored()

  const unipeptUrl = ref(initial.unipeptUrl)
  const opensearchUrl = ref(initial.opensearchUrl)
  const opensearchIndex = ref(initial.opensearchIndex)
  const batchSize = ref(initial.batchSize)
  const lcaBatchSize = ref(initial.lcaBatchSize)
  const taxaBatchSize = ref(initial.taxaBatchSize)
  const parallelRequests = ref(initial.parallelRequests)
  const minLength = ref(initial.minLength)
  const equateIL = ref(initial.equateIL)
  const cleavageMethod = ref(initial.cleavageMethod)
  const cleavageRegex = ref(initial.cleavageRegex)
  const minProteins = ref(initial.minProteins)
  const computePerTaxonUnique = ref(initial.computePerTaxonUnique)
  const computeUniqueSharedPeptides = ref(initial.computeUniqueSharedPeptides)

  watch(
    [unipeptUrl, opensearchUrl, opensearchIndex, batchSize, lcaBatchSize, taxaBatchSize, parallelRequests, minLength, equateIL, cleavageMethod, cleavageRegex, minProteins, computePerTaxonUnique, computeUniqueSharedPeptides],
    () => {
      const cfg: Config = {
        unipeptUrl: unipeptUrl.value,
        opensearchUrl: opensearchUrl.value,
        opensearchIndex: opensearchIndex.value,
        batchSize: batchSize.value,
        lcaBatchSize: lcaBatchSize.value,
        taxaBatchSize: taxaBatchSize.value,
        parallelRequests: parallelRequests.value,
        minLength: minLength.value,
        equateIL: equateIL.value,
        cleavageMethod: cleavageMethod.value,
        cleavageRegex: cleavageRegex.value,
        minProteins: minProteins.value,
        computePerTaxonUnique: computePerTaxonUnique.value,
        computeUniqueSharedPeptides: computeUniqueSharedPeptides.value,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
    },
  )

  function resetToDefaults() {
    unipeptUrl.value = DEFAULTS.unipeptUrl
    opensearchUrl.value = DEFAULTS.opensearchUrl
    opensearchIndex.value = DEFAULTS.opensearchIndex
    batchSize.value = DEFAULTS.batchSize
    lcaBatchSize.value = DEFAULTS.lcaBatchSize
    taxaBatchSize.value = DEFAULTS.taxaBatchSize
    parallelRequests.value = DEFAULTS.parallelRequests
    minLength.value = DEFAULTS.minLength
    equateIL.value = DEFAULTS.equateIL
    cleavageMethod.value = DEFAULTS.cleavageMethod
    cleavageRegex.value = DEFAULTS.cleavageRegex
    minProteins.value = DEFAULTS.minProteins
    computePerTaxonUnique.value = DEFAULTS.computePerTaxonUnique
    computeUniqueSharedPeptides.value = DEFAULTS.computeUniqueSharedPeptides
  }

  const hasComputationEnabled = computed(() => computePerTaxonUnique.value || computeUniqueSharedPeptides.value)

  function applyAnalysisParams(params: AnalysisParams) {
    minLength.value = params.minLength
    equateIL.value = params.equateIL
    cleavageMethod.value = params.cleavageMethod
    cleavageRegex.value = params.cleavageRegex
    minProteins.value = params.minProteins
    computePerTaxonUnique.value = params.computePerTaxonUnique
    computeUniqueSharedPeptides.value = params.computeUniqueSharedPeptides
  }

  return { unipeptUrl, opensearchUrl, opensearchIndex, batchSize, lcaBatchSize, taxaBatchSize, parallelRequests, minLength, equateIL, cleavageMethod, cleavageRegex, minProteins, computePerTaxonUnique, computeUniqueSharedPeptides, hasComputationEnabled, resetToDefaults, applyAnalysisParams }
})
