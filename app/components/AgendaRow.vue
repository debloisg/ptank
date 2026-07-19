<script setup lang="ts">
const props = defineProps<{
  to: string
  title?: string
  date?: string
  location?: string
  category?: string
}>()

// Short date "21 juin" for the agenda column.
const shortDate = computed(() =>
  props.date
    ? new Date(props.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
    : null,
)
</script>

<template>
  <NuxtLink
    :to="to"
    class="group grid grid-cols-[5.5rem_1fr] sm:grid-cols-[7rem_1fr_auto] items-baseline gap-x-4 gap-y-1 border-t border-default py-5 transition-colors hover:bg-elevated/60"
  >
    <span class="font-serif text-lg text-highlighted">{{ shortDate ?? '—' }}</span>

    <span class="min-w-0">
      <span class="block font-medium text-highlighted transition-colors group-hover:text-primary">
        {{ title }}
      </span>
      <span v-if="location" class="block text-sm text-muted">{{ location }}</span>
    </span>

    <span
      v-if="category"
      class="eyebrow !text-[0.68rem] col-start-2 sm:col-start-3 justify-self-start sm:justify-self-end !text-dimmed"
    >
      {{ category }}
    </span>
  </NuxtLink>
</template>
