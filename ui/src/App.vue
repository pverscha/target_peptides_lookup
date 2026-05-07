<script setup lang="ts">
import { ref } from 'vue'
import ConfigPanel from './components/ConfigPanel.vue'
import TaxonInput from './components/TaxonInput.vue'
import AnalysisConfig from './components/AnalysisConfig.vue'
import PipelineProgress from './components/PipelineProgress.vue'
import ResultsPanel from './components/ResultsPanel.vue'
import LogViewer from './components/LogViewer.vue'

const showConfig = ref(false)
</script>

<template>
  <v-app>
    <v-app-bar color="primary" density="compact" elevation="1">
      <v-app-bar-title class="text-body-1 font-weight-medium">
        Target Peptides Identifier
      </v-app-bar-title>
      <template #append>
        <v-btn
          icon="mdi-cog-outline"
          variant="text"
          @click="showConfig = true"
        />
      </template>
    </v-app-bar>

    <ConfigPanel v-model="showConfig" />

    <v-main>
      <v-container max-width="1520" class="py-6">
        <v-row class="align-start">
          <!-- Left column: pipeline flow -->
          <v-col cols="12" md="8">
            <AnalysisConfig />
            <TaxonInput />
            <PipelineProgress />
            <ResultsPanel />
          </v-col>

          <!-- Right column: log -->
          <v-col cols="12" md="4" class="log-column">
            <LogViewer />
          </v-col>
        </v-row>
      </v-container>
    </v-main>
  </v-app>
</template>

<style scoped>
.log-column {
  max-height: calc(100vh - 64px - 48px);
  display: flex;
  flex-direction: column;
}

.log-column > :deep(.log-card) {
  max-height: calc(100vh - 64px - 48px);
}
</style>
