import { computed } from 'vue'
import { usePipelineStore } from '@/stores/pipeline'

export function usePipelineStatus() {
  const pipeline = usePipelineStore()
  return {
    isRunning: computed(() => pipeline.status === 'running'),
    isFinished: computed(() => ['done', 'error', 'cancelled'].includes(pipeline.status)),
  }
}
