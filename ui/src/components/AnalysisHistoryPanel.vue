<script setup lang="ts">
import type { AnalysisSummary } from '@/types'

const props = defineProps<{
  modelValue: boolean
  history: AnalysisSummary[]
  loading: boolean
  saveError: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  restore: [id: number]
  remove: [id: number]
}>()

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function taxonLabel(entry: AnalysisSummary): string {
  const names = entry.inputTaxonNames.slice(0, 3).join(', ')
  return entry.inputTaxonCount > 3 ? `${names} +${entry.inputTaxonCount - 3} more` : names
}
</script>

<template>
  <v-dialog
    :model-value="props.modelValue"
    max-width="640"
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon icon="mdi-history" class="mr-2" />
        Analysis History
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" density="compact" @click="emit('update:modelValue', false)" />
      </v-card-title>

      <v-divider />

      <v-alert
        v-if="saveError"
        type="error"
        variant="tonal"
        density="compact"
        class="ma-3"
        :text="saveError"
      />

      <v-card-text class="pa-0">
        <div v-if="loading && history.length === 0" class="d-flex justify-center pa-6">
          <v-progress-circular indeterminate color="primary" />
        </div>

        <div v-else-if="history.length === 0" class="text-center text-medium-emphasis pa-8">
          <v-icon icon="mdi-history" size="48" class="mb-3 d-block" />
          No saved analyses yet. Completed pipeline runs are saved automatically.
        </div>

        <v-list v-else lines="two">
          <v-list-item
            v-for="entry in history"
            :key="entry.id"
          >
            <v-list-item-title class="text-body-2 font-weight-medium">
              {{ formatDate(entry.savedAt) }}
            </v-list-item-title>
            <v-list-item-subtitle class="text-caption">
              {{ taxonLabel(entry) }}
              &bull;
              {{ entry.intersectionPeptideCount }} shared &bull; {{ entry.uniquePeptideCount }} unique
            </v-list-item-subtitle>

            <template #append>
              <div class="d-flex ga-1">
                <v-tooltip text="Restore this analysis" location="bottom">
                  <template #activator="{ props: tp }">
                    <v-btn
                      v-bind="tp"
                      icon="mdi-restore"
                      variant="text"
                      density="compact"
                      size="small"
                      color="primary"
                      @click="emit('restore', entry.id)"
                    />
                  </template>
                </v-tooltip>
                <v-tooltip text="Delete" location="bottom">
                  <template #activator="{ props: tp }">
                    <v-btn
                      v-bind="tp"
                      icon="mdi-delete-outline"
                      variant="text"
                      density="compact"
                      size="small"
                      color="error"
                      @click="emit('remove', entry.id)"
                    />
                  </template>
                </v-tooltip>
              </div>
            </template>
          </v-list-item>
        </v-list>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>
