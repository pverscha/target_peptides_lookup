<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { formatLogLines } from '@/utils/format'
import { downloadText } from '@/utils/download'
import { usePipelineStatus } from '@/composables/usePipelineStatus'
import ConfigPanel from './components/ConfigPanel.vue'
import TaxonInput from './components/TaxonInput.vue'
import AnalysisConfig from './components/AnalysisConfig.vue'
import StepCard from './components/StepCard.vue'
import ResultsPanel from './components/ResultsPanel.vue'
import LogViewer from './components/LogViewer.vue'
import { usePipelineStore } from '@/stores/pipeline'

const showConfig = ref(false)
const logDrawerOpen = ref(true)
const showSteps = ref(false)
const taxonInputRef = ref<InstanceType<typeof TaxonInput> | null>(null)
const pipeline = usePipelineStore()

const { isFinished } = usePipelineStatus()

const doneCount = computed(() => pipeline.steps.filter(s => s.status === 'done').length)
const activeStep = computed(() => pipeline.steps.find(s => s.status === 'running'))

const statusDotColor = computed(() => ({
  idle: 'grey', running: 'primary', done: 'success', error: 'error', cancelled: 'grey',
}[pipeline.status] ?? 'grey'))

const statusLabel = computed(() => ({
  idle: 'Ready', running: 'Running', done: 'Pipeline complete',
  error: 'Pipeline error', cancelled: 'Cancelled',
}[pipeline.status] ?? ''))

function downloadLog() {
  downloadText(formatLogLines(pipeline.logs), 'pipeline-log.txt')
}

async function copyLog() {
  await navigator.clipboard.writeText(formatLogLines(pipeline.logs))
}

const selectedTaxaCount = computed(() => taxonInputRef.value?.selectedTaxa?.value?.length ?? 0)

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter') return
  if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return
  if (pipeline.status !== 'running') taxonInputRef.value?.runPipeline()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
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

    <!-- Zone 1: Left permanent drawer -->
    <v-navigation-drawer permanent location="left" :width="340">
      <!-- Header -->
      <div class="left-drawer-header d-flex align-center px-4 py-3">
        <span class="text-subtitle-2 font-weight-bold mr-auto">Setup</span>
        <div class="d-flex ga-4">
          <v-tooltip text="Import taxa from file" location="bottom">
            <template #activator="{ props: tp }">
              <v-btn
                v-bind="tp"
                icon="mdi-file-import-outline"
                variant="text"
                density="compact"
                size="small"
                :disabled="pipeline.status === 'running'"
                :loading="taxonInputRef?.fileLoading"
                @click="taxonInputRef?.triggerFileInput()"
              />
            </template>
          </v-tooltip>
          <v-tooltip text="Reset pipeline" location="bottom">
            <template #activator="{ props: tp }">
              <v-btn
                v-bind="tp"
                icon="mdi-restore"
                variant="text"
                density="compact"
                size="small"
                :disabled="!isFinished"
                @click="pipeline.reset()"
              />
            </template>
          </v-tooltip>
        </div>
      </div>
      <v-divider />

      <!-- Body (scrollable) -->
      <div class="left-drawer-body">
        <AnalysisConfig />
        <v-divider />
        <TaxonInput ref="taxonInputRef" :hide-buttons="true" />
      </div>

      <!-- Actions (fixed bottom) -->
      <div class="left-drawer-actions pa-3">
        <v-divider class="mb-3" />

        <v-btn
          v-if="pipeline.status !== 'running'"
          color="primary"
          variant="flat"
          prepend-icon="mdi-play"
          block
          class="mb-2"
          @click="taxonInputRef?.runPipeline()"
        >
          Run Pipeline
        </v-btn>
        <v-btn
          v-else
          color="warning"
          variant="flat"
          prepend-icon="mdi-stop"
          block
          class="mb-2"
          @click="pipeline.cancel()"
        >
          Cancel
        </v-btn>

        <div v-if="pipeline.status !== 'running'" class="text-caption text-center text-medium-emphasis">
          {{ selectedTaxaCount }} taxa selected · press ↵ to run
        </div>
      </div>
    </v-navigation-drawer>

    <!-- Zone 3: Right collapsible drawer -->
    <v-navigation-drawer
      permanent
      location="right"
      :rail="!logDrawerOpen"
      :width="380"
      :rail-width="48"
    >
      <!-- Collapsed state -->
      <template v-if="!logDrawerOpen">
        <div class="d-flex flex-column align-center pt-2 ga-2">
          <v-btn
            icon="mdi-chevron-left"
            variant="text"
            density="compact"
            @click="logDrawerOpen = true"
          />
          <div class="log-collapsed-label text-medium-emphasis">Log</div>
        </div>
      </template>

      <!-- Expanded state -->
      <template v-else>
        <!-- Header -->
        <div class="right-drawer-header d-flex align-center px-4 py-3">
          <span class="text-subtitle-2 font-weight-bold mr-2">Log</span>
          <v-chip
            v-if="pipeline.logs.length > 0"
            size="x-small"
            color="secondary"
            variant="tonal"
            class="mr-auto"
          >
            {{ pipeline.logs.length }}
          </v-chip>
          <span v-else class="mr-auto" />
          <div class="d-flex ga-4">
            <v-tooltip text="Download log as text file" location="bottom">
              <template #activator="{ props: tooltipProps }">
                <v-btn
                  v-bind="tooltipProps"
                  icon="mdi-download-outline"
                  variant="text"
                  density="compact"
                  size="small"
                  :disabled="pipeline.logs.length === 0"
                  @click="downloadLog"
                />
              </template>
            </v-tooltip>
            <v-tooltip text="Copy log to clipboard" location="bottom">
              <template #activator="{ props: tooltipProps }">
                <v-btn
                  v-bind="tooltipProps"
                  icon="mdi-content-copy"
                  variant="text"
                  density="compact"
                  size="small"
                  :disabled="pipeline.logs.length === 0"
                  @click="copyLog"
                />
              </template>
            </v-tooltip>
            <v-tooltip text="Collapse panel" location="bottom">
              <template #activator="{ props: tooltipProps }">
                <v-btn
                  v-bind="tooltipProps"
                  icon="mdi-chevron-right"
                  variant="text"
                  density="compact"
                  size="small"
                  @click="logDrawerOpen = false"
                />
              </template>
            </v-tooltip>
          </div>
        </div>
        <v-divider />

        <LogViewer class="right-drawer-log" />

        <v-expand-transition>
          <div v-if="showSteps" class="right-drawer-steps">
            <v-divider />
            <template v-for="(step, index) in pipeline.steps" :key="step.id">
              <StepCard :step="step" />
              <v-divider v-if="index < pipeline.steps.length - 1" />
            </template>
          </div>
        </v-expand-transition>

        <div class="right-drawer-footer">
          <v-divider />
          <div class="px-4 py-3">
            <div class="d-flex align-center ga-2">
              <v-icon
                icon="mdi-circle"
                size="10"
                :color="statusDotColor"
                :class="{ 'mdi-spin': pipeline.status === 'running' }"
              />
              <span class="text-body-2 font-weight-medium">{{ statusLabel }}</span>
              <span class="text-caption text-medium-emphasis">
                {{ doneCount }}/{{ pipeline.steps.length }}
              </span>
            </div>
            <div v-if="activeStep" class="d-flex align-start ga-2 mt-2">
              <v-icon
                icon="mdi-loading"
                size="14"
                color="primary"
                class="mdi-spin mt-1 flex-shrink-0"
              />
              <div class="flex-grow-1 min-width-0">
                <div class="text-caption font-weight-medium text-truncate">{{ activeStep.label }}</div>
                <div v-if="activeStep.detail" class="text-caption text-medium-emphasis text-truncate">
                  {{ activeStep.detail }}
                </div>
                <v-progress-linear
                  :model-value="activeStep.progress !== null ? activeStep.progress * 100 : 0"
                  :indeterminate="activeStep.progress === null"
                  color="primary"
                  height="2"
                  rounded
                  class="mt-1"
                />
              </div>
            </div>

            <div class="mt-1">
              <v-btn
                variant="text"
                size="x-small"
                color="primary"
                density="compact"
                class="pa-0 text-caption"
                @click="showSteps = !showSteps"
              >
                {{ showSteps ? 'hide steps' : 'view steps' }}
              </v-btn>
            </div>
          </div>
        </div>
      </template>
    </v-navigation-drawer>

    <!-- Zone 2: Main content -->
    <v-main scrollable>
      <v-container fluid class="pt-0">
        <ResultsPanel />
      </v-container>
    </v-main>
  </v-app>
</template>

<style scoped>
:deep(.v-navigation-drawer__content) {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.left-drawer-header {
  flex-shrink: 0;
}

.left-drawer-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.left-drawer-actions {
  flex-shrink: 0;
}

.right-drawer-header {
  flex-shrink: 0;
}

.right-drawer-log {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.right-drawer-steps {
  flex-shrink: 0;
  overflow-y: auto;
  max-height: 40vh;
}

.right-drawer-footer {
  flex-shrink: 0;
}

.log-collapsed-label {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  transform: rotate(180deg);
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100px;
  font-size: 0.75rem;
  font-weight: 500;
  margin: 8px auto 0;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
</style>
