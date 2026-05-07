<script setup lang="ts">
import { computed } from 'vue'
import { usePipelineStore } from '@/stores/pipeline'
import { fmtN } from '@/utils/format'

const pipeline = usePipelineStore()

const show = computed(
  () => pipeline.status === 'done' && pipeline.uniquePeptides.length > 0,
)

function downloadTsv() {
  const content = pipeline.uniquePeptides.join('\n')
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'unique_peptides.txt'
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <v-card v-if="show" class="mb-4">
    <v-card-title class="text-subtitle-1 font-weight-medium pa-4 pb-2">
      Results
    </v-card-title>
    <v-divider />
    <v-card-text class="pt-4">
      <!-- Stats row -->
      <v-row dense class="mb-3">
        <v-col cols="6" sm="3">
          <v-card variant="tonal" color="primary" class="pa-3 text-center">
            <div class="text-h6 font-weight-bold">{{ fmtN(pipeline.validTaxaIds.length) }}</div>
            <div class="text-caption">Input taxa</div>
          </v-card>
        </v-col>
        <v-col cols="6" sm="3">
          <v-card variant="tonal" color="secondary" class="pa-3 text-center">
            <div class="text-h6 font-weight-bold">{{ fmtN(pipeline.descendantIds.length) }}</div>
            <div class="text-caption">Descendant species</div>
          </v-card>
        </v-col>
        <v-col cols="6" sm="3">
          <v-card variant="tonal" color="info" class="pa-3 text-center">
            <div class="text-h6 font-weight-bold">{{ fmtN(pipeline.intersectionPeptides.length) }}</div>
            <div class="text-caption">Shared peptides</div>
          </v-card>
        </v-col>
        <v-col cols="6" sm="3">
          <v-card variant="tonal" color="success" class="pa-3 text-center">
            <div class="text-h6 font-weight-bold">{{ fmtN(pipeline.uniquePeptides.length) }}</div>
            <div class="text-caption">Unique peptides</div>
          </v-card>
        </v-col>
      </v-row>

      <!-- Peptide list -->
      <v-sheet
        rounded
        border
        style="max-height: 320px; overflow-y: auto;"
        class="pa-0"
      >
        <v-virtual-scroll
          :items="pipeline.uniquePeptides"
          item-height="28"
          style="max-height: 320px;"
        >
          <template #default="{ item }">
            <div class="px-3 py-1 text-body-2 font-mono text-mono">{{ item }}</div>
          </template>
        </v-virtual-scroll>
      </v-sheet>
    </v-card-text>

    <v-card-actions class="px-4 pb-4">
      <v-btn
        color="primary"
        variant="tonal"
        prepend-icon="mdi-download"
        @click="downloadTsv"
      >
        Download ({{ fmtN(pipeline.uniquePeptides.length) }} peptides)
      </v-btn>
    </v-card-actions>
  </v-card>

  <!-- Done with zero unique peptides -->
  <v-alert
    v-else-if="pipeline.status === 'done' && pipeline.uniquePeptides.length === 0"
    type="info"
    variant="tonal"
    class="mb-4"
    text="Pipeline complete. No unique peptides were identified for the given taxon set."
  />
</template>
