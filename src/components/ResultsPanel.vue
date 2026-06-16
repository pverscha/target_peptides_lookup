<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DataTableHeader } from 'vuetify'
import { usePipelineStore } from '@/stores/pipeline'
import { useConfigStore } from '@/stores/config'
import { fmtN, fmtPercent } from '@/utils/format'
import { downloadText } from '@/utils/download'
import { isLeafRank } from '@/utils/taxa'
import NotComputedCard from './NotComputedCard.vue'

const pipeline = usePipelineStore()
const config = useConfigStore()

const show = computed(() => pipeline.status === 'done')

const sharedTab = ref<'all' | 'unique'>('all')

const uniquePeptideSet = computed(() => new Set(pipeline.uniquePeptides))
const uniqueSharedSkipped = computed(() => pipeline.status === 'done' && !pipeline.uniqueSharedPeptidesComputed && !config.computeUniqueSharedPeptides)
const perTaxonNotComputed = computed(() => pipeline.status === 'done' && !pipeline.perTaxonUniqueComputed)
const perTaxonSkipped = computed(() => perTaxonNotComputed.value && !config.computePerTaxonUnique)
const perTaxonNoResults = computed(() => perTaxonNotComputed.value && config.computePerTaxonUnique)

function downloadPeptides(peptides: string[], filename: string) {
  downloadText(peptides.join('\n'), filename)
}

function perTaxonPeptides(id: number) { return pipeline.perTaxonUniquePeptides[id] ?? [] }

function isPartial(id: number): boolean {
  return !isLeafRank(pipeline.taxonRanks[id])
}

interface CoverageItem {
  peptide: string
  count: number
  total: number
  pct: string
}

const partialCoverageHeaders: DataTableHeader[] = [
  { title: 'Peptide',                     align: 'start', value: 'peptide', sortable: true, width: '40%' },
  { title: 'Matching species',            align: 'end',   value: 'count',   sortable: true, width: '20%' },
  { title: 'Total species',               align: 'end',   value: 'total',   sortable: true, width: '20%' },
  { title: 'Partial coverage percentage', align: 'end',   value: 'pct',     sortable: true, width: '20%' },
]

/** Coverage rows for a higher-level taxon, already in display order (stored sort). */
function perTaxonCoverageItems(id: number): CoverageItem[] {
  const cov = pipeline.perTaxonCoverage[id]
  const total = (pipeline.descendantsByTaxon[id] ?? []).length
  if (!cov || total === 0) return []
  return perTaxonPeptides(id).map((peptide) => {
    const count = cov[peptide]?.length ?? 0
    return { peptide, count, total, pct: fmtPercent(count, total) }
  })
}

function downloadPartialPeptides(id: number): void {
  const items = perTaxonCoverageItems(id)
  const header = 'peptide\tspecies_with_peptide\ttotal_species\tcoverage_percent'
  const rows = items.map((r) => `${r.peptide}\t${r.count}\t${r.total}\t${r.pct}`)
  downloadText([header, ...rows].join('\n'), `partial_peptides_${id}.tsv`)
}

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
  // Pass the full TaxonSuggestion objects (not just IDs) so rank survives the re-run.
  pipeline.run([...pipeline.inputTaxa])
}

function runUniqueSharedAnalysis() {
  config.computeUniqueSharedPeptides = true
  // Pass the full TaxonSuggestion objects (not just IDs) so rank survives the re-run.
  pipeline.run([...pipeline.inputTaxa])
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

    <v-card v-else-if="perTaxonNoResults" class="mb-4">
      <v-card-title class="text-subtitle-1 font-weight-medium pa-4 pb-2">
        Per-taxon unique peptides
      </v-card-title>
      <v-divider />
      <v-card-text class="pt-4">
        <v-alert
          type="info"
          variant="tonal"
          density="compact"
          text="No valid per-taxon unique peptides could be produced for the selected taxa. This typically occurs when no peptides are shared across all input taxa."
        />
      </v-card-text>
    </v-card>

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
                <!-- Partially-covering peptides chip (higher-level taxa) -->
                <v-chip
                  v-if="isPartial(taxId)"
                  size="x-small"
                  :color="perTaxonPeptides(taxId).length > 0 ? 'warning' : 'default'"
                  variant="tonal"
                >
                  {{ fmtN(perTaxonPeptides(taxId).length) }} partially covering
                </v-chip>
                <!-- Strict-unique peptides chip (species / strain taxa) -->
                <v-chip
                  v-else
                  size="x-small"
                  :color="perTaxonPeptides(taxId).length > 0 ? 'success' : 'default'"
                  variant="tonal"
                >
                  {{ fmtN(perTaxonPeptides(taxId).length) }} unique
                </v-chip>
              </div>
            </v-expansion-panel-title>
            <v-expansion-panel-text>

              <!-- ── Higher-level taxon: partially-covering peptides with coverage ── -->
              <template v-if="isPartial(taxId)">
                <template v-if="perTaxonPeptides(taxId).length > 0">
                  <v-data-table
                    :headers="partialCoverageHeaders"
                    :items="perTaxonCoverageItems(taxId)"
                    :items-per-page="10"
                    density="compact"
                    color="primary"
                    class="mb-3 partial-coverage-table"
                  >
                    <template #item.peptide="{ item }">
                      <v-tooltip :text="item.peptide" location="top">
                        <template #activator="{ props }">
                          <span v-bind="props" class="font-mono text-mono peptide-cell">{{ item.peptide }}</span>
                        </template>
                      </v-tooltip>
                    </template>
                    <template #item.pct="{ item }">
                      {{ item.pct }}
                    </template>
                  </v-data-table>
                  <v-btn
                    size="small"
                    color="primary"
                    variant="tonal"
                    prepend-icon="mdi-download"
                    @click="downloadPartialPeptides(taxId)"
                  >
                    Download ({{ fmtN(perTaxonPeptides(taxId).length) }} partially covering peptides)
                  </v-btn>
                </template>
                <v-alert
                  v-else
                  type="info"
                  variant="tonal"
                  density="compact"
                  text="No partially covering peptides identified for this taxon."
                />
              </template>

              <!-- ── Leaf taxon (species / strain): strict unique peptides ── -->
              <template v-else>
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
              </template>

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

<style scoped>
.partial-coverage-table :deep(table) {
  table-layout: fixed;
}
.peptide-cell {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
