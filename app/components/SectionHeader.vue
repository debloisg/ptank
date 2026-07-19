<script setup lang="ts">
defineProps<{
  eyebrow?: string
  title: string
  subtitle?: string
}>()
</script>

<template>
  <div class="mb-10 max-w-2xl">
    <p v-if="eyebrow" class="eyebrow mb-3">{{ eyebrow }}</p>
    <h1 class="font-serif text-4xl sm:text-5xl font-semibold tracking-tight text-highlighted">
      {{ title }}
    </h1>
    <p v-if="subtitle" class="mt-4 text-lg text-muted">{{ subtitle }}</p>
  </div>
</template>
