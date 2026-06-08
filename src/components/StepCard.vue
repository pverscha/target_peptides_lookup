<script setup lang="ts">
import { computed } from 'vue'
import type { PipelineStep } from '@/types'

const props = defineProps<{ step: PipelineStep }>()

const statusColor: Record<string, string> = {
  idle: 'grey',
  running: 'primary',
  done: 'success',
  error: 'error',
  skipped: 'grey-lighten-1',
}

const statusIcon: Record<string, string> = {
  idle: 'mdi-clock-outline',
  running: 'mdi-loading',
  done: 'mdi-check-circle',
  error: 'mdi-alert-circle',
  skipped: 'mdi-minus-circle-outline',
}

// Split "1,166,818 shared peptides" → { number: "1,166,818", rest: "shared peptides" }
const detailParts = computed(() => {
  const d = props.step.detail
  if (!d) return null
  const match = d.match(/^([\d,]+)\s+(.+)$/)
  if (match) return { number: match[1], rest: match[2] }
  return { number: null, rest: d }
})
</script>

<template>
  <div class="step-row">
    <div class="step-row-inner d-flex align-center ga-6 px-6 py-4">
      <v-icon
        :icon="statusIcon[step.status] ?? 'mdi-clock-outline'"
        :color="statusColor[step.status] ?? 'grey'"
        :class="{ 'mdi-spin': step.status === 'running' }"
        size="22"
      />
      <div class="flex-grow-1">
        <div class="text-body-2 font-weight-semibold">{{ step.label }}</div>
        <div v-if="detailParts" class="text-caption detail-line mt-1">
          <span v-if="detailParts.number" class="detail-number">{{ detailParts.number }}</span>
          <span class="text-medium-emphasis">{{ detailParts.number ? ' ' : '' }}{{ detailParts.rest }}</span>
        </div>
      </div>
      <v-chip
        v-if="step.status !== 'idle'"
        size="x-small"
        :color="statusColor[step.status] ?? 'grey'"
        variant="tonal"
        class="status-chip"
      >
        <span class="status-dot" :class="`bg-${statusColor[step.status] ?? 'grey'}`" />
        {{ step.status }}
      </v-chip>
    </div>
    <v-progress-linear
      v-if="step.status === 'running'"
      :model-value="step.progress !== null ? step.progress * 100 : 0"
      :indeterminate="step.progress === null"
      color="primary"
      height="2"
    />
  </div>
</template>

<style scoped>
.step-row {
  position: relative;
}

.detail-number {
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.87);
}

.status-chip {
  font-size: 11px;
  letter-spacing: 0.01em;
}

.status-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-right: 5px;
  flex-shrink: 0;
}
</style>
