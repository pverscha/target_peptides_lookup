<script setup lang="ts">
defineProps<{
  title: string
  description: string
  buttonLabel: string
}>()

defineEmits<{ (e: 'run'): void }>()
</script>

<template>
  <v-card variant="outlined" style="border-style: dashed; background: rgb(var(--v-theme-surface));">
    <v-card-text class="pa-5">
      <div class="d-flex align-start ga-4">
        <v-sheet rounded="lg" border color="surface" class="pa-3 flex-shrink-0 d-flex align-center justify-center" width="52" height="52">
          <v-icon icon="mdi-flask-outline" size="22" color="medium-emphasis" />
        </v-sheet>
        <div>
          <div class="d-flex align-center flex-wrap ga-2 mb-1">
            <span class="text-subtitle-1 font-weight-bold">{{ title }}</span>
            <v-chip size="x-small" variant="tonal">NOT COMPUTED</v-chip>
          </div>
          <div class="text-body-2 text-medium-emphasis mb-4">{{ description }}</div>
          <v-btn color="primary" variant="flat" prepend-icon="mdi-play" @click="$emit('run')">
            {{ buttonLabel }}
          </v-btn>
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>
