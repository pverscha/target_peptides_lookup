<script setup lang="ts">
import { ref } from 'vue'
import { usePipelineStore } from '@/stores/pipeline'
import { useConfigStore } from '@/stores/config'
import { parseTaxonInput } from '@/utils/peptides'
import { UnipeptService } from '@/services/UnipeptService'
import { TaxonRepository } from '@/repositories/TaxonRepository'
import type { TaxonSuggestion } from '@/types'
import TaxonBrowser from './TaxonBrowser.vue'

const pipeline = usePipelineStore()
const config = useConfigStore()

const selectedTaxa = ref<TaxonSuggestion[]>([])
const inputErrors = ref<string[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const fileLoading = ref(false)

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

function runPipeline() {
  if (selectedTaxa.value.length === 0) {
    inputErrors.value = ['Select at least one taxon before running the pipeline.']
    return
  }
  inputErrors.value = []
  void pipeline.run(selectedTaxa.value.map((t) => t.id))
}

const isRunning = () => pipeline.status === 'running'
const isFinished = () => ['done', 'error', 'cancelled'].includes(pipeline.status)
</script>

<template>
  <v-card class="mb-4">
    <v-card-title class="text-subtitle-1 font-weight-medium pa-4 pb-2">
      Select Taxa
    </v-card-title>
    <v-divider />
    <v-card-text class="pt-4">
      <TaxonBrowser v-model="selectedTaxa" />

      <v-alert
        v-for="(err, i) in inputErrors"
        :key="i"
        type="error"
        variant="tonal"
        density="compact"
        class="mt-2 mb-1 text-caption"
        :text="err"
      />

      <div class="d-flex flex-wrap mt-4">
        <v-btn
          color="primary"
          variant="flat"
          prepend-icon="mdi-play"
          :disabled="isRunning()"
          class="mr-1"
          @click="runPipeline"
        >
          Run pipeline
        </v-btn>

        <v-btn
          variant="tonal"
          prepend-icon="mdi-upload"
          :disabled="isRunning()"
          :loading="fileLoading"
          class="mx-1"
          @click="fileInput?.click()"
        >
          Import from file
        </v-btn>
        <input
          ref="fileInput"
          type="file"
          accept=".txt,text/plain"
          style="display: none"
          @change="onFileChange"
        />

        <v-btn
          v-if="isRunning()"
          color="warning"
          variant="tonal"
          prepend-icon="mdi-stop"
          class="ml-1"
          @click="pipeline.cancel()"
        >
          Cancel
        </v-btn>

        <v-btn
          v-if="isFinished()"
          variant="tonal"
          prepend-icon="mdi-refresh"
          class="ml-1"
          @click="pipeline.reset()"
        >
          Reset
        </v-btn>
      </div>
    </v-card-text>
  </v-card>
</template>
