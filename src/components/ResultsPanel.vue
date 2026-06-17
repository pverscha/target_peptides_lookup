<script setup lang="ts">
import { computed } from 'vue'
import { usePipelineStore } from '@/stores/pipeline'
import ResultsSummaryStats from './ResultsSummaryStats.vue'
import PerTaxonUniquePeptidesCard from './PerTaxonUniquePeptidesCard.vue'
import SharedPeptidesCard from './SharedPeptidesCard.vue'

const pipeline = usePipelineStore()

const show = computed(() => pipeline.status === 'done')
</script>

<template>
  <!-- Empty states when pipeline has not produced results yet -->
  <div v-if="!show" class="py-16 text-center">
    <template v-if="pipeline.status === 'idle'">
      <v-icon size="48" color="medium-emphasis">mdi-beaker-outline</v-icon>
      <div class="text-body-2 font-weight-medium mt-3">No analysis run yet</div>
      <div class="text-caption text-medium-emphasis mt-1">
        Configure your analysis, select target taxa, and click "Run Pipeline" to view results here.
      </div>
    </template>
    <template v-else-if="pipeline.status === 'running'">
      <v-icon size="48" color="primary" class="mdi-spin">mdi-loading</v-icon>
      <div class="text-body-2 font-weight-medium mt-3">Analysis in progress</div>
      <div class="text-caption text-medium-emphasis mt-1">
        Results will appear here once the pipeline completes.
      </div>
    </template>
    <template v-else-if="pipeline.status === 'paused'">
      <v-icon size="48" color="warning">mdi-pause-circle-outline</v-icon>
      <div class="text-body-2 font-weight-medium mt-3">Analysis paused</div>
      <div class="text-caption text-medium-emphasis mt-1">
        Resume from the left panel to continue, or cancel to stop the run.
      </div>
    </template>
    <template v-else-if="pipeline.status === 'interrupted'">
      <v-icon size="48" color="error">mdi-wifi-off</v-icon>
      <div class="text-body-2 font-weight-medium mt-3">Connection lost</div>
      <div class="text-caption text-medium-emphasis mt-1">
        A network request failed. Resume from the left panel once you're back online, or cancel.
      </div>
    </template>
    <template v-else-if="pipeline.status === 'error'">
      <v-icon size="48" color="error">mdi-alert-circle-outline</v-icon>
      <div class="text-body-2 font-weight-medium mt-3">Pipeline error</div>
      <div class="text-caption text-medium-emphasis mt-1">
        The pipeline encountered an error. See the log panel for details, then use "Reset" to start over.
      </div>
    </template>
    <template v-else-if="pipeline.status === 'cancelled'">
      <v-icon size="48" color="medium-emphasis">mdi-cancel</v-icon>
      <div class="text-body-2 font-weight-medium mt-3">Analysis cancelled</div>
      <div class="text-caption text-medium-emphasis mt-1">
        The pipeline was cancelled. Use "Reset" to start a new analysis.
      </div>
    </template>
  </div>

  <template v-else>
    <div class="text-h5 font-weight-medium mb-4 mt-4">Results</div>

    <ResultsSummaryStats
      :input-taxa-count="pipeline.validTaxaIds.length"
      :descendant-species-count="pipeline.descendantIds.length"
      :shared-peptides-count="pipeline.intersectionPeptides.length"
      :unique-shared-peptides-count="pipeline.uniquePeptides.length"
      class="mb-4"
    />

    <PerTaxonUniquePeptidesCard class="mb-4" />

    <SharedPeptidesCard />
  </template>
</template>
