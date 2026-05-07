import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { Config } from '@/types'

const STORAGE_KEY = 'tpi_config'

const DEFAULTS: Config = {
  unipeptUrl: 'https://api.unipept.ugent.be',
  opensearchUrl: 'http://patty.taild1497.ts.net:9200',
  opensearchIndex: 'uniprot_entries',
  batchSize: 100,
  minLength: 6,
  equateIL: true,
  cleavageMethod: 'tryptic',
  cleavageRegex: '(?<=[KR])(?!P)',
  minProteins: 1,
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
  const minLength = ref(initial.minLength)
  const equateIL = ref(initial.equateIL)
  const cleavageMethod = ref(initial.cleavageMethod)
  const cleavageRegex = ref(initial.cleavageRegex)
  const minProteins = ref(initial.minProteins)

  watch(
    [unipeptUrl, opensearchUrl, opensearchIndex, batchSize, minLength, equateIL, cleavageMethod, cleavageRegex, minProteins],
    () => {
      const cfg: Config = {
        unipeptUrl: unipeptUrl.value,
        opensearchUrl: opensearchUrl.value,
        opensearchIndex: opensearchIndex.value,
        batchSize: batchSize.value,
        minLength: minLength.value,
        equateIL: equateIL.value,
        cleavageMethod: cleavageMethod.value,
        cleavageRegex: cleavageRegex.value,
        minProteins: minProteins.value,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
    },
  )

  function resetToDefaults() {
    unipeptUrl.value = DEFAULTS.unipeptUrl
    opensearchUrl.value = DEFAULTS.opensearchUrl
    opensearchIndex.value = DEFAULTS.opensearchIndex
    batchSize.value = DEFAULTS.batchSize
    minLength.value = DEFAULTS.minLength
    equateIL.value = DEFAULTS.equateIL
    cleavageMethod.value = DEFAULTS.cleavageMethod
    cleavageRegex.value = DEFAULTS.cleavageRegex
    minProteins.value = DEFAULTS.minProteins
  }

  return { unipeptUrl, opensearchUrl, opensearchIndex, batchSize, minLength, equateIL, cleavageMethod, cleavageRegex, minProteins, resetToDefaults }
})
