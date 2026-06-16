import { computed } from 'vue'
import { usePipelineStore, ACTIVE_STATUSES, FINISHED_STATUSES } from '@/stores/pipeline'

export function usePipelineStatus() {
  const pipeline = usePipelineStore()
  return {
    isRunning: computed(() => pipeline.status === 'running'),
    isPaused: computed(() => pipeline.status === 'paused'),
    isInterrupted: computed(() => pipeline.status === 'interrupted'),
    isActive: computed(() => ACTIVE_STATUSES.includes(pipeline.status)),
    isFinished: computed(() => FINISHED_STATUSES.includes(pipeline.status)),
  }
}
