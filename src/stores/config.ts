import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { Config, AnalysisParams } from '@/types'

const STORAGE_KEY = 'tpi_config'

const DEFAULTS: Config = {
  unipeptUrl: 'https://api.unipept.ugent.be',
  batchSize: 1000,
  lcaBatchSize: 1000,
  parallelRequests: 5,
  minLength: 6,
  equateIL: true,
  cleavageMethod: 'tryptic',
  cleavageRegex: '(?<=[KR])(?!P)',
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
  const batchSize = ref(initial.batchSize)
  const lcaBatchSize = ref(initial.lcaBatchSize)
  const parallelRequests = ref(initial.parallelRequests)
  const minLength = ref(initial.minLength)
  const equateIL = ref(initial.equateIL)
  const cleavageMethod = ref(initial.cleavageMethod)
  const cleavageRegex = ref(initial.cleavageRegex)

  watch(
    [unipeptUrl, batchSize, lcaBatchSize, parallelRequests, minLength, equateIL, cleavageMethod, cleavageRegex],
    () => {
      const cfg: Config = {
        unipeptUrl: unipeptUrl.value,
        batchSize: batchSize.value,
        lcaBatchSize: lcaBatchSize.value,
        parallelRequests: parallelRequests.value,
        minLength: minLength.value,
        equateIL: equateIL.value,
        cleavageMethod: cleavageMethod.value,
        cleavageRegex: cleavageRegex.value,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
    },
  )

  function resetToDefaults() {
    unipeptUrl.value = DEFAULTS.unipeptUrl
    batchSize.value = DEFAULTS.batchSize
    lcaBatchSize.value = DEFAULTS.lcaBatchSize
    parallelRequests.value = DEFAULTS.parallelRequests
    minLength.value = DEFAULTS.minLength
    equateIL.value = DEFAULTS.equateIL
    cleavageMethod.value = DEFAULTS.cleavageMethod
    cleavageRegex.value = DEFAULTS.cleavageRegex
  }

  function applyAnalysisParams(params: AnalysisParams) {
    minLength.value = params.minLength
    equateIL.value = params.equateIL
    cleavageMethod.value = params.cleavageMethod
    cleavageRegex.value = params.cleavageRegex
  }

  return { unipeptUrl, batchSize, lcaBatchSize, parallelRequests, minLength, equateIL, cleavageMethod, cleavageRegex, resetToDefaults, applyAnalysisParams }
})
