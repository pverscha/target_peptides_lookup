<script setup lang="ts">
import type { TaxonSuggestion } from '@/types'
import { rankColor } from '@/utils/colors'

defineProps<{ taxon: TaxonSuggestion }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <v-chip
    closable
    :color="rankColor(taxon.rank)"
    variant="tonal"
    @click:close="$emit('close')"
  >
    {{ taxon.name }}
    <span class="text-medium-emphasis ml-2" style="font-size: 0.75em; vertical-align: middle;">NCBI {{ taxon.id }}</span>
  </v-chip>
</template>
