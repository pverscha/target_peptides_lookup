<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePipelineStore } from '@/stores/pipeline'
import { useConfigStore } from '@/stores/config'
import { fmtN } from '@/utils/format'
import { downloadText } from '@/utils/download'

const pipeline = usePipelineStore()
const config = useConfigStore()

const sharedTab = ref<'all' | 'unique'>('all')

const uniquePeptideSet = computed(() => new Set(pipeline.uniquePeptides))

function downloadPeptides(peptides: string[], filename: string): void {
  downloadText(peptides.join('\n'), filename)
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
</script>

<template>
  <div>
    <div class="text-h6 font-weight-medium mb-1">Shared peptides across all selected taxa</div>
    <v-card>
      <v-card-text>

        <v-tabs v-model="sharedTab" density="compact" class="mb-3">
          <v-tab value="all">
            All shared
            <v-chip size="x-small" class="ml-2" variant="tonal">{{ fmtN(pipeline.intersectionPeptides.length) }}</v-chip>
          </v-tab>
          <v-tab value="unique">
            Unique to this group
            <v-chip size="x-small" class="ml-2" color="success" variant="tonal">{{ fmtN(pipeline.uniquePeptides.length) }}</v-chip>
          </v-tab>
        </v-tabs>

        <v-tabs-window v-model="sharedTab">

          <!-- All shared peptides with LCA -->
          <v-tabs-window-item value="all">
            <template v-if="pipeline.intersectionPeptides.length > 0">
              <v-sheet rounded border style="max-height: 360px;" class="mb-3">
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
            <template v-if="pipeline.uniquePeptides.length > 0">
              <v-sheet rounded border style="max-height: 360px;" class="mb-3">
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
  </div>
</template>
