<script setup lang="ts">
import { useConfigStore } from '@/stores/config'

defineProps<{ modelValue: boolean }>()
defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const config = useConfigStore()
</script>

<template>
  <v-navigation-drawer
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    location="right"
    temporary
    width="360"
  >
    <v-list-item
      title="Connection"
      prepend-icon="mdi-cog-outline"
      class="py-4"
    />
    <v-divider />

    <v-container class="pa-4">
      <v-text-field
        v-model="config.unipeptUrl"
        label="Unipept URL"
        density="compact"
        variant="outlined"
        class="mb-3"
      />
      <v-text-field
        v-model="config.opensearchUrl"
        label="OpenSearch URL"
        density="compact"
        variant="outlined"
        class="mb-3"
      />
      <v-text-field
        v-model="config.opensearchIndex"
        label="OpenSearch index"
        density="compact"
        variant="outlined"
        class="mb-3"
      />
      <v-text-field
        v-model.number="config.batchSize"
        label="Batch size"
        type="number"
        :min="1"
        :max="1000"
        density="compact"
        variant="outlined"
        class="mb-3"
      />
      <v-text-field
        v-model.number="config.parallelRequests"
        label="Parallel LCA requests"
        type="number"
        :min="1"
        :max="20"
        density="compact"
        variant="outlined"
        class="mb-4"
      />
      <v-btn
        variant="tonal"
        color="secondary"
        prepend-icon="mdi-restore"
        block
        @click="config.resetToDefaults"
      >
        Reset to defaults
      </v-btn>
    </v-container>
  </v-navigation-drawer>
</template>
