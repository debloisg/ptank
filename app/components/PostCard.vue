<script setup lang="ts">
// Editorial post card (news / résultats / home "À la une"): a Nuxt UI
// <UBlogPost> with a brand meta line (CATÉGORIE · date) and an inline
// "Lire la suite" affordance kept inside the padded body.
const props = defineProps<{
  to: string
  title?: string
  description?: string
  date?: string
  category?: string
  image?: string
}>()

const formattedDate = computed(() =>
  props.date
    ? new Date(props.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : '',
)
</script>

<template>
  <UBlogPost :to="to" :title="title" :image="image">
    <template #badge>
      <span class="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold uppercase tracking-[0.14em]">
        <span v-if="category" class="text-secondary">{{ category }}</span>
        <span v-if="category && date" class="text-dimmed">·</span>
        <span v-if="date" class="text-dimmed">{{ formattedDate }}</span>
      </span>
    </template>
    <template #description>
      <span v-if="description" class="block">{{ description }}</span>
      <span class="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
        Lire la suite
        <UIcon name="i-lucide-arrow-right" class="size-4 transition-transform group-hover/blog-post:translate-x-0.5" />
      </span>
    </template>
  </UBlogPost>
</template>
