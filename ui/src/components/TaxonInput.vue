<script setup lang="ts">
import { ref } from 'vue'
import { usePipelineStore } from '@/stores/pipeline'
import { useConfigStore } from '@/stores/config'
import { usePipelineStatus } from '@/composables/usePipelineStatus'
import { parseTaxonInput } from '@/utils/peptides'
import { UnipeptService } from '@/services/UnipeptService'
import { TaxonRepository } from '@/repositories/TaxonRepository'
import type { TaxonSuggestion } from '@/types'
import { rankColor } from '@/utils/colors'
import TaxonBrowser from './TaxonBrowser.vue'

const props = withDefaults(defineProps<{ hideButtons?: boolean }>(), { hideButtons: false })

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

const { isRunning, isFinished } = usePipelineStatus()

defineExpose({ runPipeline, fileLoading, triggerFileInput: () => fileInput.value?.click(), selectedTaxa })
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
      <v-chip
        v-for="taxon in selectedTaxa"
        :key="taxon.id"
        closable
        :color="rankColor(taxon.rank)"
        variant="tonal"
        @click:close="deselect(taxon)"
      >
        {{ taxon.name }}
        <span class="text-medium-emphasis ml-2" style="font-size: 0.75em;">{{ taxon.id }}</span>
      </v-chip>
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

    <!-- Add taxa button -->
    <v-btn
      variant="outlined"
      prepend-icon="mdi-plus"
      block
      @click="showTaxonDialog = true"
    >
      Add taxa
    </v-btn>

    <!-- Hidden file input -->
    <input
      ref="fileInput"
      type="file"
      accept=".txt,text/plain"
      style="display: none"
      @change="onFileChange"
    />

    <!-- Taxon browser dialog -->
    <v-dialog v-model="showTaxonDialog" max-width="960" scrollable>
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

    <template v-if="!props.hideButtons">
      <div class="d-flex flex-wrap mt-4">
        <v-btn
          color="primary"
          variant="flat"
          prepend-icon="mdi-play"
          :disabled="isRunning"
          class="mr-1"
          @click="runPipeline"
        >
          Run pipeline
        </v-btn>

        <v-btn
          variant="tonal"
          prepend-icon="mdi-upload"
          :disabled="isRunning"
          :loading="fileLoading"
          class="mx-1"
          @click="fileInput?.click()"
        >
          Import from file
        </v-btn>

        <v-btn
          v-if="isRunning"
          color="warning"
          variant="tonal"
          prepend-icon="mdi-stop"
          class="ml-1"
          @click="pipeline.cancel()"
        >
          Cancel
        </v-btn>

        <v-btn
          v-if="isFinished"
          variant="tonal"
          prepend-icon="mdi-refresh"
          class="ml-1"
          @click="pipeline.reset()"
        >
          Reset
        </v-btn>
      </div>
    </template>
  </div>
</template>
