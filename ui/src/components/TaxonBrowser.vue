<script setup lang="ts">
import { ref, watch } from 'vue'
import type { DataTableHeader } from 'vuetify'
import type { TaxonSuggestion } from '@/types'
import { useConfigStore } from '@/stores/config'
import { UnipeptService } from '@/services/UnipeptService'
import { TaxonRepository } from '@/repositories/TaxonRepository'
import { OpensearchService } from '@/services/OpensearchService'
import { ProteinRepository } from '@/repositories/ProteinRepository'
import { rankColor } from '@/utils/colors'
import { isAbortError } from '@/utils/abort'
import TaxonChip from './TaxonChip.vue'

const selectedTaxa = defineModel<TaxonSuggestion[]>({ default: [] })

const config = useConfigStore()

const filterValue = ref('')
const debouncedFilter = ref('')
const tableLoading = ref(false)
const rows = ref<TaxonSuggestion[]>([])
const totalRows = ref(0)
const proteinCounts = ref<Record<number, number>>({})


const headers: DataTableHeader[] = [
  { title: 'NCBI ID',  align: 'start', value: 'id',       width: '12%', sortable: true  },
  { title: 'Name',     align: 'start', value: 'name',     width: '38%', sortable: true  },
  { title: 'Rank',     align: 'start', value: 'rank',     width: '20%', sortable: true  },
  { title: 'Proteins', align: 'end',   value: 'proteins', width: '15%', sortable: false },
  { title: '',         align: 'start', value: 'action',   width: '15%', sortable: false },
]

function isSelected(taxon: TaxonSuggestion): boolean {
  return selectedTaxa.value.some((t) => t.id === taxon.id)
}

function select(taxon: TaxonSuggestion) {
  if (!isSelected(taxon)) selectedTaxa.value = [...selectedTaxa.value, taxon]
}

function deselect(taxon: TaxonSuggestion) {
  selectedTaxa.value = selectedTaxa.value.filter((t) => t.id !== taxon.id)
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let loadController: AbortController | null = null
let prefetchController: AbortController | null = null

watch(filterValue, (val) => {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { debouncedFilter.value = val }, 350)
})

function makeRepo(): TaxonRepository {
  return new TaxonRepository(new UnipeptService({
    unipeptUrl: config.unipeptUrl,
    batchSize: config.batchSize,
    equateIL: config.equateIL,
  }))
}

function makeProteinRepo(): ProteinRepository {
  return new ProteinRepository(new OpensearchService({
    opensearchUrl: config.opensearchUrl,
    opensearchIndex: config.opensearchIndex,
  }))
}

type TableOptions = {
  page: number
  itemsPerPage: number
  sortBy: { key: string; order: 'asc' | 'desc' }[]
}

type CachedPage = {
  taxa: TaxonSuggestion[]
  proteinCounts: Record<number, number>
}

const MAX_CACHE_SIZE = 20
const pageCache = new Map<string, CachedPage>()
let lastQueryParams = { filter: '', sortBy: 'name', sortDesc: false }

function cacheKey(filter: string, page: number, sortBy: string, sortDesc: boolean): string {
  return JSON.stringify({ filter, page, sortBy, sortDesc })
}

function setCachedPage(key: string, value: CachedPage) {
  if (pageCache.size >= MAX_CACHE_SIZE && !pageCache.has(key)) {
    pageCache.delete(pageCache.keys().next().value!)
  }
  pageCache.set(key, value)
}

async function prefetchPage(
  filter: string, page: number, itemsPerPage: number,
  sortBy: 'id' | 'name' | 'rank', sortDesc: boolean,
  signal: AbortSignal,
) {
  const key = cacheKey(filter, page, sortBy, sortDesc)
  if (pageCache.has(key)) return

  try {
    const start = (page - 1) * itemsPerPage
    const taxa = await makeRepo().search(filter, start, start + itemsPerPage, sortBy, sortDesc, signal)
    if (signal.aborted) return
    const counts = await makeProteinRepo().countByTaxon(taxa.map((t) => t.id), signal)
    if (!signal.aborted) setCachedPage(key, { taxa, proteinCounts: counts })
  } catch (err) {
    if (isAbortError(err)) return
  }
}

async function loadTaxa(options: TableOptions) {
  prefetchController?.abort()
  loadController?.abort()
  loadController = new AbortController()
  const signal = loadController.signal

  const sortItem = options.sortBy[0]
  const sortBy = (sortItem?.key ?? 'name') as 'id' | 'name' | 'rank'
  const sortDesc = sortItem?.order === 'desc'

  if (debouncedFilter.value !== lastQueryParams.filter || sortBy !== lastQueryParams.sortBy || sortDesc !== lastQueryParams.sortDesc) {
    pageCache.clear()
    lastQueryParams = { filter: debouncedFilter.value, sortBy, sortDesc }
  }

  const key = cacheKey(debouncedFilter.value, options.page, sortBy, sortDesc)
  const cached = pageCache.get(key)

  tableLoading.value = true
  try {
    if (cached) {
      rows.value = cached.taxa
      proteinCounts.value = cached.proteinCounts
    } else {
      const start = (options.page - 1) * options.itemsPerPage
      const end = start + options.itemsPerPage

      const repo = makeRepo()
      const [count, page] = await Promise.all([
        repo.count(debouncedFilter.value, signal),
        repo.search(debouncedFilter.value, start, end, sortBy, sortDesc, signal),
      ])

      totalRows.value = count
      rows.value = page

      try {
        proteinCounts.value = await makeProteinRepo().countByTaxon(page.map((t) => t.id), signal)
        if (signal.aborted) return
      } catch (err) {
        if (isAbortError(err)) return
        console.error('Failed to load protein counts:', err)
        proteinCounts.value = {}
      }
    }

    prefetchController = new AbortController()
    const prefetchSignal = prefetchController.signal
    for (let i = 1; i <= 3; i++) {
      if ((options.page + i - 1) * options.itemsPerPage < totalRows.value) {
        prefetchPage(debouncedFilter.value, options.page + i, options.itemsPerPage, sortBy, sortDesc, prefetchSignal)
      }
    }
  } catch (err) {
    if (isAbortError(err)) return
    console.error('Failed to load taxa:', err)
  } finally {
    tableLoading.value = false
  }
}
</script>

<template>
  <div>
    <!-- Selected taxa summary -->
    <div class="mb-3">
      <div v-if="selectedTaxa.length === 0" class="text-caption text-medium-emphasis">
        No taxa selected yet. Select taxa from the table below.
      </div>
      <div v-else class="d-flex flex-wrap ga-1">
        <TaxonChip
          v-for="taxon in selectedTaxa"
          :key="taxon.id"
          :taxon="taxon"
          class="ma-1"
          @close="deselect(taxon)"
        />
      </div>
    </div>

    <!-- Browser table -->
    <v-data-table-server
      :headers="headers"
      :items="rows"
      :items-length="totalRows"
      :items-per-page="10"
      :loading="tableLoading"
      :search="debouncedFilter"
      density="compact"
      color="primary"
      @update:options="loadTaxa"
    >
      <template #footer.prepend>
        <v-text-field
          v-model="filterValue"
          class="mr-6"
          color="primary"
          prepend-inner-icon="mdi-magnify"
          clearable
          clear-icon="mdi-close"
          label="Search"
          density="compact"
          variant="outlined"
          hide-details
          @click:clear="filterValue = ''"
        />
      </template>

      <template #item.proteins="{ item }">
        <span class="text-body-2">{{ proteinCounts[item.id]?.toLocaleString() ?? '—' }}</span>
      </template>

      <template #item.rank="{ item }">
        <div class="d-flex align-center">
          <div
            style="height: 10px; width: 10px; border-radius: 50%; flex-shrink: 0;"
            :class="`mr-2 bg-${rankColor(item.rank)}`"
          />
          {{ item.rank }}
        </div>
      </template>

      <template #item.action="{ item }">
        <v-btn
          v-if="isSelected(item)"
          color="red"
          density="compact"
          variant="text"
          prepend-icon="mdi-minus"
          @click="deselect(item)"
        >
          Remove
        </v-btn>
        <v-btn
          v-else
          color="primary"
          density="compact"
          variant="text"
          prepend-icon="mdi-plus"
          @click="select(item)"
        >
          Select
        </v-btn>
      </template>
    </v-data-table-server>

    <div class="text-caption mt-n2 ml-1">
      Search by name, NCBI ID, or rank.
    </div>
  </div>
</template>
