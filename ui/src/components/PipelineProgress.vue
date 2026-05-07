<script setup lang="ts">
import { computed } from 'vue'
import { usePipelineStore } from '@/stores/pipeline'
import StepCard from './StepCard.vue'

const pipeline = usePipelineStore()

const doneCount = computed(() => pipeline.steps.filter(s => s.status === 'done').length)
const totalCount = computed(() => pipeline.steps.length)
</script>

<template>
  <v-card v-if="pipeline.status !== 'idle'">
    <v-card-title class="text-subtitle-1 font-weight-medium pa-4 pb-2 d-flex align-center justify-space-between">
      Pipeline Progress
      <span class="text-caption text-medium-emphasis font-weight-regular">{{ doneCount }} / {{ totalCount }} complete</span>
    </v-card-title>
    <v-divider />
    <template v-for="(step, index) in pipeline.steps" :key="step.id">
      <StepCard :step="step" />
      <v-divider v-if="index < pipeline.steps.length - 1" />
    </template>
  </v-card>
</template>

<style scoped>
</style>
