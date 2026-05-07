<script setup lang="ts">
import type { PipelineStep } from '@/types'

defineProps<{ step: PipelineStep }>()

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
</script>

<template>
  <v-card variant="outlined" :color="step.status === 'error' ? 'error' : undefined" class="mb-1">
    <v-card-text class="pb-1">
      <div class="d-flex align-center gap-2">
        <v-icon
          :icon="statusIcon[step.status] ?? 'mdi-clock-outline'"
          :color="statusColor[step.status] ?? 'grey'"
          :class="{ 'mdi-spin': step.status === 'running' }"
          size="20"
        />
        <span class="text-body-2 font-weight-medium">{{ step.label }}</span>
        <v-spacer />
        <v-chip
          v-if="step.status !== 'idle'"
          size="x-small"
          :color="statusColor[step.status] ?? 'grey'"
          variant="tonal"
        >
          {{ step.status }}
        </v-chip>
      </div>
      <div v-if="step.detail" class="text-caption text-medium-emphasis mt-1 ml-7">
        {{ step.detail }}
      </div>
    </v-card-text>
    <v-progress-linear
      v-if="step.status === 'running'"
      :model-value="step.progress !== null ? step.progress * 100 : 0"
      :indeterminate="step.progress === null"
      color="primary"
      height="2"
    />
  </v-card>
</template>
