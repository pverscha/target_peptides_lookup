<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePipelineStore } from '@/stores/pipeline'
import { useConfigStore } from '@/stores/config'
import { fmtN } from '@/utils/format'
import { downloadText } from '@/utils/download'
import NotComputedCard from './NotComputedCard.vue'

const pipeline = usePipelineStore()
const config = useConfigStore()

const show = computed(() => pipeline.status === 'done')

const sharedTab = ref<'all' | 'unique'>('all')

const uniquePeptideSet = computed(() => new Set(pipeline.uniquePeptides))
const uniqueSharedSkipped = computed(() => pipeline.status === 'done' && !pipeline.uniqueSharedPeptidesComputed)
const perTaxonSkipped = computed(() => pipeline.status === 'done' && !pipeline.perTaxonUniqueComputed)

function downloadPeptides(peptides: string[], filename: string) {
  downloadText(peptides.join('\n'), filename)
}

function perTaxonPeptides(id: number) { return pipeline.perTaxonUniquePeptides[id] ?? [] }

function lcaLabel(peptide: string): string {
  const lca = pipeline.lcaByPeptide[peptide]
  if (!lca) return ''
  return lca.rank ? `${lca.name} (${lca.rank})` : lca.name
}

function unipeptPeptideUrl(peptide: string): string {
  const webBase = config.unipeptUrl.replace('//api.', '//')
  const equate = config.equateIL ? 'true' : 'false'
  return `${webBase}/spa/${encodeURIComponent(peptide)}?equate=${equate}`
}

function runPerTaxonAnalysis() {
  config.computePerTaxonUnique = true
  pipeline.run([...pipeline.validTaxaIds])
}

function runUniqueSharedAnalysis() {
  config.computeUniqueSharedPeptides = true
  pipeline.run([...pipeline.validTaxaIds])
}
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
    <div class="text-h6 font-weight-medium mb-4 mt-4">Results</div>

    <!-- Summary stats -->
    <v-row dense class="mb-4">
      <v-col cols="6" sm="3">
        <v-card variant="tonal" color="primary" class="pa-3 text-center h-100 d-flex flex-column align-center justify-center">
          <div class="text-h6 font-weight-bold">{{ fmtN(pipeline.validTaxaIds.length) }}</div>
          <div class="text-caption">Input taxa</div>
        </v-card>
      </v-col>
      <v-col cols="6" sm="3">
        <v-card variant="tonal" color="teal" class="pa-3 text-center h-100 d-flex flex-column align-center justify-center">
          <div class="text-h6 font-weight-bold">{{ fmtN(pipeline.descendantIds.length) }}</div>
          <div class="text-caption">Descendant species</div>
        </v-card>
      </v-col>
      <v-col cols="6" sm="3">
        <v-card variant="tonal" color="info" class="pa-3 text-center h-100 d-flex flex-column align-center justify-center">
          <div class="text-h6 font-weight-bold">{{ fmtN(pipeline.intersectionPeptides.length) }}</div>
          <div class="text-caption">Shared peptides</div>
        </v-card>
      </v-col>
      <v-col cols="6" sm="3">
        <v-card variant="tonal" :color="uniqueSharedSkipped ? 'default' : 'success'" class="pa-3 text-center h-100 d-flex flex-column align-center justify-center">
          <div class="text-h6 font-weight-bold" :class="{ 'text-medium-emphasis': uniqueSharedSkipped }">
            {{ uniqueSharedSkipped ? '—' : fmtN(pipeline.uniquePeptides.length) }}
          </div>
          <div class="text-caption">Unique shared peptides</div>
          <div v-if="uniqueSharedSkipped" class="text-caption font-italic text-medium-emphasis">not computed</div>
        </v-card>
      </v-col>
    </v-row>

    <!-- Per-taxon unique peptides card -->
    <NotComputedCard
      v-if="perTaxonSkipped"
      class="mb-4"
      title="Per-taxon unique peptides"
      description="You disabled the per-taxon analysis in this run, so unique peptides for each selected taxon were not calculated."
      button-label="Run per-taxon analysis"
      @run="runPerTaxonAnalysis"
    />

    <v-card v-else class="mb-4">
      <v-card-title class="text-subtitle-1 font-weight-medium pa-4 pb-2">
        Per-taxon unique peptides
      </v-card-title>
      <v-divider />
      <v-card-text class="pt-4">
        <v-expansion-panels variant="accordion">
          <v-expansion-panel
            v-for="taxId in pipeline.validTaxaIds"
            :key="taxId"
          >
            <v-expansion-panel-title>
              <div class="d-flex align-center flex-wrap ga-2">
                <span class="font-weight-medium">{{ pipeline.taxonNames[taxId] ?? taxId }}</span>
                <v-chip size="x-small" color="secondary" variant="tonal">NCBI {{ taxId }}</v-chip>
                <v-chip
                  size="x-small"
                  :color="perTaxonPeptides(taxId).length > 0 ? 'success' : 'default'"
                  variant="tonal"
                >
                  {{ fmtN(perTaxonPeptides(taxId).length) }} unique
                </v-chip>
              </div>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <template v-if="perTaxonPeptides(taxId).length > 0">
                <v-sheet rounded border style="max-height: 280px; overflow-y: auto;" class="mb-3">
                  <v-virtual-scroll
                    :items="perTaxonPeptides(taxId)"
                    item-height="28"
                    style="max-height: 280px;"
                  >
                    <template #default="{ item }">
                      <div class="px-3 py-1 text-body-2 font-mono text-mono">{{ item }}</div>
                    </template>
                  </v-virtual-scroll>
                </v-sheet>
                <v-btn
                  size="small"
                  color="primary"
                  variant="tonal"
                  prepend-icon="mdi-download"
                  @click="downloadPeptides(perTaxonPeptides(taxId), `unique_peptides_${taxId}.txt`)"
                >
                  Download ({{ fmtN(perTaxonPeptides(taxId).length) }} unique peptides)
                </v-btn>
              </template>
              <v-alert
                v-else
                type="info"
                variant="tonal"
                density="compact"
                text="No unique peptides identified for this taxon."
              />
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-card-text>
    </v-card>

    <!-- Shared peptides card -->
    <v-card class="mb-4">
      <v-card-title class="text-subtitle-1 font-weight-medium pa-4 pb-2">
        Shared peptides across all selected taxa
      </v-card-title>
      <v-divider />
      <v-card-text class="pt-4">
        <v-tabs v-model="sharedTab" density="compact" class="mb-3">
          <v-tab value="all">
            All shared
            <v-chip size="x-small" class="ml-2" variant="tonal">{{ fmtN(pipeline.intersectionPeptides.length) }}</v-chip>
          </v-tab>
          <v-tab value="unique" :style="uniqueSharedSkipped ? 'opacity: 0.55' : ''">
            Unique to this group
            <v-chip v-if="uniqueSharedSkipped" size="x-small" class="ml-2" variant="tonal">NOT COMPUTED</v-chip>
            <v-chip v-else size="x-small" class="ml-2" color="success" variant="tonal">{{ fmtN(pipeline.uniquePeptides.length) }}</v-chip>
          </v-tab>
        </v-tabs>

        <v-tabs-window v-model="sharedTab">

          <!-- All shared peptides with LCA -->
          <v-tabs-window-item value="all">
            <template v-if="pipeline.intersectionPeptides.length > 0">
              <v-sheet rounded border style="max-height: 360px; overflow-y: auto;" class="mb-3">
                <v-virtual-scroll
                  :items="pipeline.intersectionPeptides"
                  item-height="36"
                  style="max-height: 360px;"
                >
                  <template #default="{ item }">
                    <div class="d-flex align-center px-3 py-1 ga-3" style="min-height: 36px;">
                      <a
                        :href="unipeptPeptideUrl(item)"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-body-2 font-mono text-mono flex-shrink-0 text-primary text-decoration-none"
                        style="cursor: pointer;"
                      >{{ item }}</a>
                      <v-spacer />
                      <v-chip
                        v-if="lcaLabel(item)"
                        size="x-small"
                        :color="uniquePeptideSet.has(item) ? 'success' : 'warning'"
                        variant="tonal"
                        :title="uniquePeptideSet.has(item) ? 'Unique to this taxon group' : 'Shared with organisms outside selection'"
                      >
                        {{ lcaLabel(item) }}
                      </v-chip>
                      <v-chip
                        v-if="uniquePeptideSet.has(item)"
                        size="x-small"
                        color="success"
                        variant="flat"
                      >
                        unique
                      </v-chip>
                    </div>
                  </template>
                </v-virtual-scroll>
              </v-sheet>
              <v-btn
                color="primary"
                variant="tonal"
                prepend-icon="mdi-download"
                @click="downloadPeptides(pipeline.intersectionPeptides, 'shared_peptides_all.txt')"
              >
                Download all shared ({{ fmtN(pipeline.intersectionPeptides.length) }} peptides)
              </v-btn>
            </template>
            <v-alert
              v-else
              type="info"
              variant="tonal"
              density="compact"
              text="No peptides shared across all selected taxa."
            />
          </v-tabs-window-item>

          <!-- Unique shared peptides (LCA-filtered) -->
          <v-tabs-window-item value="unique">
            <NotComputedCard
              v-if="uniqueSharedSkipped"
              title="Unique shared peptides"
              description="You disabled the unique shared peptides computation in this run, so peptides exclusive to this taxon group were not identified."
              button-label="Run unique shared analysis"
              @run="runUniqueSharedAnalysis"
            />
            <template v-else-if="pipeline.uniquePeptides.length > 0">
              <v-sheet rounded border style="max-height: 360px; overflow-y: auto;" class="mb-3">
                <v-virtual-scroll
                  :items="pipeline.uniquePeptides"
                  item-height="28"
                  style="max-height: 360px;"
                >
                  <template #default="{ item }">
                    <div class="px-3 py-1">
                      <a
                        :href="unipeptPeptideUrl(item)"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-body-2 font-mono text-mono text-primary text-decoration-none"
                        style="cursor: pointer;"
                      >{{ item }}</a>
                    </div>
                  </template>
                </v-virtual-scroll>
              </v-sheet>
              <v-btn
                color="primary"
                variant="tonal"
                prepend-icon="mdi-download"
                @click="downloadPeptides(pipeline.uniquePeptides, 'unique_peptides_shared.txt')"
              >
                Download unique shared ({{ fmtN(pipeline.uniquePeptides.length) }} peptides)
              </v-btn>
            </template>
            <v-alert
              v-else
              type="info"
              variant="tonal"
              density="compact"
              text="No peptides shared and unique across all selected taxa."
            />
          </v-tabs-window-item>

        </v-tabs-window>
      </v-card-text>
    </v-card>
  </template>
</template>
