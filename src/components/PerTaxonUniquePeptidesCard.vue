<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DataTableHeader } from 'vuetify'
import { usePipelineStore } from '@/stores/pipeline'
import { fmtN, fmtPercent } from '@/utils/format'
import { downloadText } from '@/utils/download'
import { isLeafRank } from '@/utils/taxa'

const pipeline = usePipelineStore()

const perTaxonNotAvailable = computed(() => pipeline.status === 'done' && !pipeline.perTaxonUniqueAvailable)

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

interface DescendantSpeciesItem {
  id: number
  name: string
  unique: string[]
  inParent: string[]
  uniqueCount: number
  inParentCount: number
}

const descendantSpeciesHeaders: DataTableHeader[] = [
  { title: 'Species',         align: 'start', value: 'name',          sortable: true },
  { title: 'NCBI',            align: 'start', value: 'id',            sortable: true, width: '110px' },
  { title: 'Globally unique', align: 'end',   value: 'uniqueCount',   sortable: true, width: '150px' },
  { title: 'In-parent',       align: 'end',   value: 'inParentCount', sortable: true, width: '130px' },
]

/** Per-parent map of descendant species ID → parent-unique peptides it carries, inverted from
 *  pipeline.perTaxonCoverage (peptide → species[]). Recomputed only when results change. */
const inParentBySpecies = computed<Record<number, Record<number, string[]>>>(() => {
  const out: Record<number, Record<number, string[]>> = {}
  for (const [parentIdStr, cov] of Object.entries(pipeline.perTaxonCoverage)) {
    const bySpecies: Record<number, string[]> = {}
    for (const [peptide, speciesIds] of Object.entries(cov)) {
      for (const sid of speciesIds) {
        ;(bySpecies[sid] ??= []).push(peptide)
      }
    }
    for (const list of Object.values(bySpecies)) list.sort()
    out[Number(parentIdStr)] = bySpecies
  }
  return out
})

const allDescendantSpeciesItems = computed<Record<number, DescendantSpeciesItem[]>>(() => {
  const result: Record<number, DescendantSpeciesItem[]> = {}
  for (const taxId of pipeline.validTaxaIds) {
    if (isLeafRank(pipeline.taxonRanks[taxId])) continue
    const speciesIds = pipeline.descendantsByTaxon[taxId] ?? []
    const inParentMap = inParentBySpecies.value[taxId] ?? {}
    result[taxId] = speciesIds
      .map((id) => {
        const unique = pipeline.perSpeciesUniquePeptides[id] ?? []
        const inParent = inParentMap[id] ?? []
        return {
          id,
          name: pipeline.taxonNames[id] ?? String(id),
          unique,
          inParent,
          uniqueCount: unique.length,
          inParentCount: inParent.length,
        }
      })
      .sort((a, b) => (b.uniqueCount - a.uniqueCount) || a.name.localeCompare(b.name))
  }
  return result
})

const speciesSearch = ref<Record<number, string>>({})

function downloadSpeciesUnique(item: DescendantSpeciesItem): void {
  downloadText(item.unique.join('\n'), `unique_peptides_${item.id}.txt`)
}

function downloadSpeciesInParent(parentId: number, item: DescendantSpeciesItem): void {
  downloadText(item.inParent.join('\n'), `inparent_peptides_${parentId}_${item.id}.txt`)
}

function downloadPeptides(peptides: string[], filename: string): void {
  downloadText(peptides.join('\n'), filename)
}
</script>

<template>
  <!-- Not available: no per-taxon unique peptides could be produced -->
  <v-card v-if="perTaxonNotAvailable" class="mb-4">
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

  <div v-else>
    <div class="text-h6 font-weight-medium mb-1">Unique peptides per selected taxon</div>
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

            <!-- ── Descendant species drill-down ── -->
            <v-divider class="my-4" />
            <div class="d-flex align-center flex-wrap ga-2 mb-1">
                <span class="text-subtitle-2 font-weight-medium">
                  Descendant species ({{ fmtN((pipeline.descendantsByTaxon[taxId] ?? []).length) }})
                </span>
              <v-spacer />
              <v-text-field
                  v-model="speciesSearch[taxId]"
                  density="compact"
                  variant="outlined"
                  hide-details
                  clearable
                  prepend-inner-icon="mdi-magnify"
                  placeholder="Search species"
                  style="max-width: 260px;"
              />
            </div>
            <div class="text-caption text-medium-emphasis mb-2">
              Globally unique: peptides unique to that species across all of Unipept.
              In-parent: parent-unique peptides the species carries.
            </div>
            <v-data-table
                :headers="descendantSpeciesHeaders"
                :items="allDescendantSpeciesItems[taxId] ?? []"
                :search="speciesSearch[taxId] ?? ''"
                :items-per-page="10"
                density="compact"
                show-expand
                class="descendant-species-table"
            >
              <template #item.id="{ item }">
                <v-chip size="x-small" color="secondary" variant="tonal">{{ item.id }}</v-chip>
              </template>
              <template #item.uniqueCount="{ item }">
                <v-chip
                    size="x-small"
                    :color="item.uniqueCount > 0 ? 'success' : 'default'"
                    variant="tonal"
                >
                  {{ fmtN(item.uniqueCount) }}
                </v-chip>
              </template>
              <template #item.inParentCount="{ item }">
                <v-chip
                    size="x-small"
                    :color="item.inParentCount > 0 ? 'warning' : 'default'"
                    variant="tonal"
                >
                  {{ fmtN(item.inParentCount) }}
                </v-chip>
              </template>
              <template #expanded-row="{ columns, item }">
                <tr>
                  <td :colspan="columns.length" class="pa-3">
                    <div class="d-flex flex-wrap ga-4">
                      <!-- Globally unique -->
                      <div style="flex: 1 1 280px; min-width: 260px;">
                        <div class="text-caption font-weight-medium mb-1">
                          Globally unique ({{ fmtN(item.uniqueCount) }})
                        </div>
                        <template v-if="item.uniqueCount > 0">
                          <v-sheet rounded border style="max-height: 220px;" class="mb-2">
                            <v-virtual-scroll :items="item.unique" item-height="28" style="max-height: 220px;">
                              <template #default="{ item: pep }">
                                <div class="px-3 py-1 text-body-2 font-mono text-mono">{{ pep }}</div>
                              </template>
                            </v-virtual-scroll>
                          </v-sheet>
                          <v-btn
                              size="small"
                              color="primary"
                              variant="tonal"
                              prepend-icon="mdi-download"
                              @click="downloadSpeciesUnique(item)"
                          >
                            Download ({{ fmtN(item.uniqueCount) }})
                          </v-btn>
                        </template>
                        <div v-else class="text-caption text-medium-emphasis">
                          No globally unique peptides.
                        </div>
                      </div>
                      <!-- In-parent contribution -->
                      <div style="flex: 1 1 280px; min-width: 260px;">
                        <div class="text-caption font-weight-medium mb-1">
                          In-parent ({{ fmtN(item.inParentCount) }})
                        </div>
                        <template v-if="item.inParentCount > 0">
                          <v-sheet rounded border style="max-height: 220px;" class="mb-2">
                            <v-virtual-scroll :items="item.inParent" item-height="28" style="max-height: 220px;">
                              <template #default="{ item: pep }">
                                <div class="px-3 py-1 text-body-2 font-mono text-mono">{{ pep }}</div>
                              </template>
                            </v-virtual-scroll>
                          </v-sheet>
                          <v-btn
                              size="small"
                              color="primary"
                              variant="tonal"
                              prepend-icon="mdi-download"
                              @click="downloadSpeciesInParent(taxId, item)"
                          >
                            Download ({{ fmtN(item.inParentCount) }})
                          </v-btn>
                        </template>
                        <div v-else class="text-caption text-medium-emphasis">
                          No in-parent peptides.
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </v-data-table>
          </template>

          <!-- ── Leaf taxon (species / strain): strict unique peptides ── -->
          <template v-else>
            <template v-if="perTaxonPeptides(taxId).length > 0">
              <v-sheet rounded border style="max-height: 280px;" class="mb-3">
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
  </div>
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
