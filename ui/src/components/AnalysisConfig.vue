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
  <v-card class="mb-4">
    <v-card-title class="text-subtitle-1 font-weight-medium pa-4 pb-2">
      Analysis Parameters
    </v-card-title>
    <v-divider />
    <v-card-text class="pt-4">
      <v-row dense>
        <!-- Cleavage method -->
        <v-col cols="12" sm="6">
          <v-select
            v-model="config.cleavageMethod"
            :items="cleavageItems"
            label="Cleavage method"
            density="compact"
            variant="outlined"
          />
        </v-col>

        <!-- Custom regex — only shown when method is custom -->
        <v-col v-if="config.cleavageMethod === 'custom'" cols="12" sm="6">
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

        <!-- Min peptide length -->
        <v-col cols="12" sm="6">
          <v-text-field
            v-model.number="config.minLength"
            label="Minimum peptide length"
            type="number"
            :min="1"
            density="compact"
            variant="outlined"
          />
        </v-col>

        <!-- Min proteins per organism -->
        <v-col cols="12" sm="6">
          <v-text-field
            v-model.number="config.minProteins"
            label="Minimum proteins per organism"
            type="number"
            :min="0"
            density="compact"
            variant="outlined"
            hint="Organisms below this threshold are excluded"
            persistent-hint
          />
        </v-col>
      </v-row>

      <v-switch
        v-model="config.equateIL"
        label="Equate I/L (treat isoleucine and leucine as identical)"
        color="primary"
        density="compact"
        class="mt-1 mb-0"
        hide-details
      />
    </v-card-text>
  </v-card>
</template>
