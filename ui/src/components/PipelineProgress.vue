<script setup lang="ts">
import { usePipelineStore } from '@/stores/pipeline'
import StepCard from './StepCard.vue'

const pipeline = usePipelineStore()
</script>

<template>
  <v-card v-if="pipeline.status !== 'idle'" class="mb-4">
    <v-card-title class="text-subtitle-1 font-weight-medium pa-4 pb-2">
      Pipeline Progress
    </v-card-title>
    <v-card-text class="pt-0">
      <StepCard v-for="step in pipeline.steps" :key="step.id" :step="step" />
    </v-card-text>
  </v-card>
</template>
