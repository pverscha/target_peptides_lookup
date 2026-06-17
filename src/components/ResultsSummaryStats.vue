<script setup lang="ts">
import { computed } from 'vue'
import { fmtN } from '@/utils/format'

const props = defineProps<{
  inputTaxaCount: number
  descendantSpeciesCount: number
  sharedPeptidesCount: number
  uniqueSharedPeptidesCount: number
}>()

const stats = computed(() => [
  { color: 'primary', value: props.inputTaxaCount,            label: 'Input taxa' },
  { color: 'teal',    value: props.descendantSpeciesCount,    label: 'Descendant species' },
  { color: 'info',    value: props.sharedPeptidesCount,       label: 'Shared peptides' },
  { color: 'success', value: props.uniqueSharedPeptidesCount, label: 'Unique shared peptides' },
])
</script>

<template>
  <v-row dense>
    <v-col v-for="stat in stats" :key="stat.label" cols="6" sm="3">
      <v-card variant="tonal" :color="stat.color" class="pa-3 text-center h-100 d-flex flex-column align-center justify-center">
        <div class="text-h6 font-weight-bold">{{ fmtN(stat.value) }}</div>
        <div class="text-caption">{{ stat.label }}</div>
      </v-card>
    </v-col>
  </v-row>
</template>
