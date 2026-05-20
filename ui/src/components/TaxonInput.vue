<script setup lang="ts">
import { ref } from 'vue'
import { usePipelineStore } from '@/stores/pipeline'
import { useConfigStore } from '@/stores/config'
import { parseTaxonInput } from '@/utils/peptides'
import { UnipeptService } from '@/services/UnipeptService'
import { TaxonRepository } from '@/repositories/TaxonRepository'
import type { TaxonSuggestion } from '@/types'
import TaxonBrowser from './TaxonBrowser.vue'
import TaxonChip from './TaxonChip.vue'

const pipeline = usePipelineStore()
const config = useConfigStore()

const selectedTaxa = ref<TaxonSuggestion[]>([])
const inputErrors = ref<string[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const fileLoading = ref(false)
const showTaxonDialog = ref(false)


function deselect(taxon: TaxonSuggestion) {
  selectedTaxa.value = selectedTaxa.value.filter((t) => t.id !== taxon.id)
}

function makeRepo(): TaxonRepository {
  return new TaxonRepository(new UnipeptService({
    unipeptUrl: config.unipeptUrl,
    batchSize: config.batchSize,
    lcaBatchSize: config.lcaBatchSize,
    taxaBatchSize: config.taxaBatchSize,
    parallelRequests: config.parallelRequests,
    equateIL: config.equateIL,
  }))
}

async function onFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return

  fileLoading.value = true
  inputErrors.value = []

  try {
    const text = await file.text()
    const { ids, errors } = parseTaxonInput(text)
    inputErrors.value = errors

    if (ids.length === 0) {
      if (errors.length === 0) inputErrors.value = ['No taxon IDs found in file.']
      return
    }

    const repo = makeRepo()
    const resolved = await repo.fetchById(ids, new AbortController().signal)

    const existingIds = new Set(selectedTaxa.value.map((t) => t.id))
    for (const taxon of resolved) {
      if (!existingIds.has(taxon.id)) {
        selectedTaxa.value = [...selectedTaxa.value, taxon]
        existingIds.add(taxon.id)
      }
    }

    const unresolved = ids.filter((id) => !resolved.some((t) => t.id === id))
    for (const id of unresolved) {
      inputErrors.value.push(`Taxon ID ${id} not found in Unipept.`)
    }
  } catch {
    inputErrors.value = ['Failed to process file. Please check its format.']
  } finally {
    fileLoading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

function clearAll() {
  selectedTaxa.value = []
  inputErrors.value = []
}

function runPipeline() {
  if (selectedTaxa.value.length === 0) {
    inputErrors.value = ['Select at least one taxon before running the pipeline.']
    return
  }
  inputErrors.value = []
  void pipeline.run(selectedTaxa.value.map((t) => t.id))
}

defineExpose({ runPipeline, selectedTaxa })
</script>

<template>
  <div class="px-4 pt-4 pb-3">
    <!-- Section header -->
    <div class="d-flex align-center mb-3">
      <span class="text-caption text-uppercase text-medium-emphasis font-weight-medium">Selected Taxa</span>
      <v-chip
        v-if="selectedTaxa.length > 0"
        size="x-small"
        color="secondary"
        variant="tonal"
        class="ml-2"
      >
        {{ selectedTaxa.length }}
      </v-chip>
      <v-spacer />
      <v-btn
        v-if="selectedTaxa.length > 0"
        variant="text"
        size="x-small"
        color="primary"
        density="compact"
        class="pa-0 text-caption"
        @click="clearAll"
      >
        Clear all
      </v-btn>
    </div>

    <!-- Selected taxa chips -->
    <div v-if="selectedTaxa.length > 0" class="d-flex flex-wrap ga-1 mb-3">
      <TaxonChip
        v-for="taxon in selectedTaxa"
        :key="taxon.id"
        :taxon="taxon"
        @close="deselect(taxon)"
      />
    </div>

    <!-- Empty state placeholder -->
    <div
      v-else
      class="d-flex flex-column align-center justify-center mb-3 pa-4 rounded"
      style="border: 1px dashed rgba(var(--v-border-color), 0.4); min-height: 72px;"
    >
      <v-icon size="20" color="medium-emphasis" class="mb-1">mdi-filter-outline</v-icon>
      <span class="text-caption text-medium-emphasis">No taxa selected</span>
    </div>

    <!-- Error alerts -->
    <v-alert
      v-for="(err, i) in inputErrors"
      :key="i"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-2 text-caption"
      :text="err"
    />

    <!-- Add taxa / import buttons -->
    <div class="d-flex ga-2">
      <v-btn
        variant="outlined"
        prepend-icon="mdi-plus"
        class="flex-grow-1 flex-basis-0"
        @click="showTaxonDialog = true"
      >
        Add taxa
      </v-btn>
      <v-btn
        variant="outlined"
        prepend-icon="mdi-file-import-outline"
        :loading="fileLoading"
        class="flex-grow-1 flex-basis-0"
        @click="fileInput?.click()"
      >
        Import
      </v-btn>
    </div>

    <!-- Hidden file input -->
    <input
      ref="fileInput"
      type="file"
      accept=".txt,text/plain"
      style="display: none"
      @change="onFileChange"
    />

    <!-- Taxon browser dialog -->
    <v-dialog v-model="showTaxonDialog" max-width="1200" scrollable>
      <v-card>
        <v-card-title class="text-subtitle-1 font-weight-medium pa-4 pb-2">
          Select Taxa
        </v-card-title>
        <v-divider />
        <v-card-text>
          <TaxonBrowser v-model="selectedTaxa" />
        </v-card-text>
        <v-divider />
        <v-card-actions>
          <v-spacer />
          <v-btn color="primary" variant="flat" @click="showTaxonDialog = false">
            Done
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
