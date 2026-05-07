<script setup lang="ts">
import { ref } from 'vue'
import ConfigPanel from './components/ConfigPanel.vue'
import TaxonInput from './components/TaxonInput.vue'
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
        <TaxonInput />
        <PipelineProgress />
        <LogViewer />
        <ResultsPanel />
      </v-container>
    </v-main>
  </v-app>
</template>
