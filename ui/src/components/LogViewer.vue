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
  <v-card>
    <v-card-title class="text-subtitle-1 font-weight-medium pa-4 pb-2 d-flex align-center justify-space-between">
      Log
      <v-chip v-if="pipeline.logs.length > 0" size="x-small" color="secondary" variant="tonal">
        {{ pipeline.logs.length }}
      </v-chip>
    </v-card-title>
    <v-divider />
    <div ref="scrollRef" class="log-scroll">
      <div v-if="pipeline.logs.length === 0" class="text-caption text-medium-emphasis px-6 py-4">
        No log entries yet.
      </div>
      <div
        v-for="(entry, i) in pipeline.logs"
        :key="i"
        class="log-entry d-flex align-start ga-4 px-6 py-2"
      >
        <v-icon
          :icon="levelIcon[entry.level] ?? 'mdi-information-outline'"
          size="14"
          :class="levelColor[entry.level] ?? 'text-medium-emphasis'"
          class="mt-1 flex-shrink-0"
        />
        <span class="text-caption font-mono" :class="levelColor[entry.level]">
          <span class="text-disabled mr-2">{{ formatTime(entry.timestamp) }}</span>{{ entry.message }}
        </span>
      </div>
    </div>
  </v-card>
</template>

<style scoped>
.log-scroll {
  overflow-y: auto;
  flex: 1;
  font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace;
}

.log-entry:not(:first-child) {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
