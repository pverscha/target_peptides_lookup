<script setup lang="ts">
import { ref, watchEffect, nextTick } from 'vue'
import { usePipelineStore } from '@/stores/pipeline'

const pipeline = usePipelineStore()
const scrollRef = ref<HTMLElement | null>(null)

watchEffect(async () => {
  if (pipeline.logs.length > 0) {
    await nextTick()
    if (scrollRef.value) {
      scrollRef.value.scrollTop = scrollRef.value.scrollHeight
    }
  }
})

const levelColor: Record<string, string> = {
  info: 'text-medium-emphasis',
  warning: 'text-warning',
  error: 'text-error',
}

const levelIcon: Record<string, string> = {
  info: 'mdi-information-outline',
  warning: 'mdi-alert-outline',
  error: 'mdi-alert-circle-outline',
}

function formatTime(d: Date): string {
  return d.toTimeString().slice(0, 8)
}
</script>

<template>
  <v-expansion-panels v-if="pipeline.logs.length > 0" class="mb-4">
    <v-expansion-panel>
      <v-expansion-panel-title class="text-subtitle-2">
        Log
        <v-chip size="x-small" class="ml-2" color="secondary" variant="tonal">
          {{ pipeline.logs.length }}
        </v-chip>
      </v-expansion-panel-title>
      <v-expansion-panel-text>
        <div ref="scrollRef" style="max-height: 240px; overflow-y: auto;">
          <div
            v-for="(entry, i) in pipeline.logs"
            :key="i"
            class="d-flex align-start gap-2 py-1"
          >
            <v-icon
              :icon="levelIcon[entry.level] ?? 'mdi-information-outline'"
              size="16"
              :class="levelColor[entry.level] ?? 'text-medium-emphasis'"
              class="mt-0"
            />
            <span class="text-caption font-mono" :class="levelColor[entry.level]">
              <span class="text-disabled mr-2">{{ formatTime(entry.timestamp) }}</span>{{ entry.message }}
            </span>
          </div>
        </div>
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>
