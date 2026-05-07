<script setup lang="ts">
import { ref, watch } from 'vue'
import type { DataTableHeader } from 'vuetify'
import type { TaxonSuggestion } from '@/types'
import { useConfigStore } from '@/stores/config'
import { UnipeptService } from '@/services/UnipeptService'
import { TaxonRepository } from '@/repositories/TaxonRepository'

const selectedTaxa = defineModel<TaxonSuggestion[]>({ default: [] })

const config = useConfigStore()

const filterValue = ref('')
const debouncedFilter = ref('')
const tableLoading = ref(false)
const rows = ref<TaxonSuggestion[]>([])
const totalRows = ref(0)

const RANK_COLORS: Record<string, string> = {
  domain:          'red',
  superkingdom:    'red-darken-2',
  kingdom:         'pink',
  subkingdom:      'pink-darken-2',
  superphylum:     'purple-lighten-2',
  phylum:          'purple',
  subphylum:       'purple-darken-2',
  superclass:      'indigo-lighten-2',
  class:           'indigo',
  subclass:        'indigo-darken-2',
  superorder:      'blue-lighten-2',
  order:           'blue',
  suborder:        'blue-darken-2',
  superfamily:     'cyan-lighten-2',
  family:          'cyan',
  subfamily:       'cyan-darken-2',
  tribe:           'teal-lighten-2',
  genus:           'teal',
  subgenus:        'teal-darken-2',
  'species group': 'green-lighten-2',
  species:         'green',
  subspecies:      'light-green',
  strain:          'lime',
  varietas:        'amber',
  forma:           'orange',
}

function rankColor(rank: string): string {
  return RANK_COLORS[rank.toLowerCase()] ?? 'grey'
}

const headers: DataTableHeader[] = [
  { title: 'NCBI ID', align: 'start', value: 'id',     width: '15%', sortable: true },
  { title: 'Name',    align: 'start', value: 'name',   width: '45%', sortable: true },
  { title: 'Rank',    align: 'start', value: 'rank',   width: '25%', sortable: true },
  { title: '',        align: 'start', value: 'action', width: '15%', sortable: false },
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

type TableOptions = {
  page: number
  itemsPerPage: number
  sortBy: { key: string; order: 'asc' | 'desc' }[]
}

async function loadTaxa(options: TableOptions) {
  loadController?.abort()
  loadController = new AbortController()
  const signal = loadController.signal

  tableLoading.value = true
  try {
    const sortItem = options.sortBy[0]
    const sortBy = (sortItem?.key ?? 'name') as 'id' | 'name' | 'rank'
    const sortDesc = sortItem?.order === 'desc'
    const start = (options.page - 1) * options.itemsPerPage
    const end = start + options.itemsPerPage

    const repo = makeRepo()
    const [count, page] = await Promise.all([
      repo.count(debouncedFilter.value, signal),
      repo.search(debouncedFilter.value, start, end, sortBy, sortDesc, signal),
    ])

    totalRows.value = count
    rows.value = page
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
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
        <v-chip
          v-for="taxon in selectedTaxa"
          :key="taxon.id"
          closable
          :color="rankColor(taxon.rank)"
          variant="tonal"
          class="ma-1"
          @click:close="deselect(taxon)"
        >
          {{ taxon.name }}
          <span class="text-caption opacity-70">({{ taxon.id }})</span>
        </v-chip>
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
