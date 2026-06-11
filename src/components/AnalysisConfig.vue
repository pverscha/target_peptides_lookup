<script setup lang="ts">
import { computed } from 'vue'
import { useConfigStore } from '@/stores/config'

const config = useConfigStore()

const cleavageRegexError = computed(() => {
  if (config.cleavageMethod !== 'custom') return ''
  if (!config.cleavageRegex) return 'Pattern is required'
  try {
    new RegExp(config.cleavageRegex)
    return ''
  } catch {
    return 'Invalid regular expression'
  }
})

const cleavageItems = [
  { title: 'Tryptic  (↓ after K/R, not before P)', value: 'tryptic' },
  { title: 'Custom regex', value: 'custom' },
]
</script>

<template>
  <div class="px-4 pt-4 pb-3">
    <div class="text-caption text-uppercase text-medium-emphasis font-weight-medium mb-3">
      Analysis Parameters
    </div>

    <v-row dense class="ga-4">
      <v-col cols="12">
        <v-select
          v-model="config.cleavageMethod"
          :items="cleavageItems"
          label="Cleavage method"
          density="compact"
          variant="outlined"
          hide-details
        />
      </v-col>

      <v-col v-if="config.cleavageMethod === 'custom'" cols="12">
        <v-text-field
          v-model="config.cleavageRegex"
          label="Cleavage regex"
          density="compact"
          variant="outlined"
          :error-messages="cleavageRegexError"
          hint="Split positions matched by this pattern"
          persistent-hint
          placeholder="e.g. (?<=[KR])(?!P)"
          spellcheck="false"
        />
      </v-col>

      <v-col cols="12">
        <v-text-field
          v-model.number="config.minLength"
          label="Min length"
          type="number"
          :min="1"
          density="compact"
          variant="outlined"
          hide-details
        />
      </v-col>

    </v-row>

    <div class="d-flex align-center mt-2">
      <v-checkbox
        v-model="config.equateIL"
        label="Equate I / L"
        color="primary"
        density="compact"
        hide-details
        class="flex-shrink-0"
      />
      <v-tooltip text="Treat isoleucine (I) and leucine (L) as identical during peptide matching." location="right" max-width="220">
        <template #activator="{ props: tp }">
          <v-icon v-bind="tp" icon="mdi-information-outline" size="14" class="ml-1 text-medium-emphasis" style="cursor: default;" />
        </template>
      </v-tooltip>
    </div>

    <div class="text-caption text-uppercase text-medium-emphasis font-weight-medium mt-4 mb-1">
      Computations
    </div>

    <div class="d-flex align-center mt-1">
      <v-checkbox
        v-model="config.computePerTaxonUnique"
        label="Unique peptides per taxon"
        color="primary"
        density="compact"
        hide-details
        class="flex-shrink-0"
      />
      <v-tooltip text="For species/strain taxa, shows strict unique peptides. For higher-level taxa (genus, family, …), shows partially covering peptides with a coverage percentage: how many descendant species carry each peptide." location="right" max-width="280">
        <template #activator="{ props: tp }">
          <v-icon v-bind="tp" icon="mdi-information-outline" size="14" class="ml-1 text-medium-emphasis" style="cursor: default;" />
        </template>
      </v-tooltip>
    </div>

    <div class="d-flex align-center mt-1">
      <v-checkbox
        v-model="config.computeUniqueSharedPeptides"
        label="Unique shared peptides"
        color="primary"
        density="compact"
        hide-details
        class="flex-shrink-0"
      />
      <v-tooltip text="Determines which shared peptides are globally unique to the selected taxon group (not found in any other organism in the Unipept database)." location="right" max-width="240">
        <template #activator="{ props: tp }">
          <v-icon v-bind="tp" icon="mdi-information-outline" size="14" class="ml-1 text-medium-emphasis" style="cursor: default;" />
        </template>
      </v-tooltip>
    </div>
  </div>
</template>
