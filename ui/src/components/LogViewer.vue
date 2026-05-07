<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { usePipelineStore } from '@/stores/pipeline'
import { formatTime } from '@/utils/format'

const pipeline = usePipelineStore()
const scrollRef = ref<HTMLElement | null>(null)

const filterLevel = ref<'all' | 'info' | 'warning' | 'error'>('all')

const warnCount  = computed(() => pipeline.logs.filter(l => l.level === 'warning').length)
const errorCount = computed(() => pipeline.logs.filter(l => l.level === 'error').length)

const filteredLogs = computed(() =>
  filterLevel.value === 'all'
    ? pipeline.logs
    : pipeline.logs.filter(l => l.level === filterLevel.value)
)

watch(filteredLogs, async () => {
  await nextTick()
  if (scrollRef.value) {
    scrollRef.value.scrollTop = scrollRef.value.scrollHeight
  }
})

const levelColor: Record<string, string> = {
  info:    'text-medium-emphasis',
  warning: 'text-warning',
  error:   'text-error',
}

const levelIcon: Record<string, string> = {
  info:    'mdi-information-outline',
  warning: 'mdi-alert-outline',
  error:   'mdi-alert-circle-outline',
}

const entryBg: Record<string, string> = {
  warning: 'log-entry-warning',
  error:   'log-entry-error',
}
</script>

<template>
  <div class="log-root">
    <!-- Filter chips -->
    <div class="log-filter-row px-3 py-2 d-flex ga-1">
      <v-chip
        size="small"
        :variant="filterLevel === 'all' ? 'flat' : 'tonal'"
        :color="filterLevel === 'all' ? 'on-surface' : undefined"
        @click="filterLevel = 'all'"
      >All</v-chip>
      <v-chip
        size="small"
        :variant="filterLevel === 'info' ? 'flat' : 'tonal'"
        :color="filterLevel === 'info' ? 'on-surface' : undefined"
        @click="filterLevel = 'info'"
      >Info</v-chip>
      <v-chip
        size="small"
        :variant="filterLevel === 'warning' ? 'flat' : 'tonal'"
        :color="filterLevel === 'warning' ? 'warning' : undefined"
        @click="filterLevel = 'warning'"
      >Warn {{ warnCount }}</v-chip>
      <v-chip
        size="small"
        :variant="filterLevel === 'error' ? 'flat' : 'tonal'"
        :color="filterLevel === 'error' ? 'error' : undefined"
        @click="filterLevel = 'error'"
      >Error {{ errorCount }}</v-chip>
    </div>
    <v-divider />

    <!-- Log entries -->
    <div ref="scrollRef" class="log-scroll">
      <div v-if="filteredLogs.length === 0" class="text-caption text-medium-emphasis px-4 py-3">
        No log entries.
      </div>
      <div
        v-for="(entry, i) in filteredLogs"
        :key="i"
        class="log-entry d-flex align-start ga-3 px-4 py-2"
        :class="entryBg[entry.level]"
      >
        <span class="log-time text-disabled text-caption flex-shrink-0">{{ formatTime(entry.timestamp) }}</span>
        <v-icon
          :icon="levelIcon[entry.level] ?? 'mdi-information-outline'"
          size="14"
          :class="levelColor[entry.level] ?? 'text-medium-emphasis'"
          class="mt-1 flex-shrink-0"
        />
        <span class="text-caption log-mono" :class="levelColor[entry.level]">{{ entry.message }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.log-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.log-filter-row {
  flex-shrink: 0;
}

.log-scroll {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace;
}

.log-time {
  min-width: 58px;
}


.log-entry:not(:first-child) {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.log-entry-warning {
  background: rgba(var(--v-theme-warning), 0.08);
}

.log-entry-error {
  background: rgba(var(--v-theme-error), 0.08);
}
</style>
