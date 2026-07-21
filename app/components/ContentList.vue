<script setup lang="ts">
// Lists every markdown file inside a folder (ex: /actualites) — most recent
// first. `layout` picks card grid (news/results) or agenda rows (events/comps).
const props = defineProps<{
  prefix: string
  eyebrow?: string
  title: string
  subtitle?: string
  layout?: 'cards' | 'rows'
  // Blog list direction (Studio-editable). horizontal = card grid,
  // vertical = stacked full-width rows. Ignored by the agenda (`rows`) layout.
  orientation?: 'horizontal' | 'vertical'
  empty?: string
}>()

// Each section folder is now its own typed collection (Phase 0 split).
const COLLECTION = {
  '/actualites': 'news',
  '/evenements': 'events',
  '/competitions': 'competitions',
  '/resultats': 'results',
} as const

const { data: items } = await useAsyncData(`list-${props.prefix}`, () =>
  queryCollection(COLLECTION[props.prefix as keyof typeof COLLECTION])
    .order('date', 'DESC')
    .all(),
)

// Map a content `category` to a <UBlogPost> badge (clay, subtle).
const badge = (category?: string) =>
  category ? { label: category, color: 'secondary' as const, variant: 'subtle' as const } : undefined
</script>

<template>
  <UContainer class="py-14 sm:py-20">
    <UPageHeader :headline="eyebrow" :title="title" :description="subtitle" class="mb-10" />

    <template v-if="items?.length">
      <div v-if="layout === 'rows'" class="border-b border-default">
        <AgendaRow
          v-for="item in items"
          :key="item.path"
          :to="item.path"
          :title="item.title"
          :date="item.date"
          :location="item.location"
          :category="item.category"
        />
      </div>

      <UBlogPosts v-else :orientation="orientation ?? 'horizontal'">
        <UBlogPost
          v-for="item in items"
          :key="item.path"
          :to="item.path"
          :title="item.title"
          :description="item.description"
          :date="item.date"
          :image="item.image"
          :badge="badge(item.category)"
          :orientation="(orientation ?? 'horizontal') === 'vertical' ? 'horizontal' : 'vertical'"
        />
      </UBlogPosts>
    </template>

    <div v-else class="rounded-2xl border border-dashed border-accented bg-elevated/50 px-6 py-12 text-center">
      <UIcon name="i-lucide-inbox" class="mx-auto mb-3 h-8 w-8 text-dimmed" />
      <p class="text-muted">{{ empty ?? 'Le contenu publié depuis Nuxt Studio apparaîtra ici.' }}</p>
    </div>
  </UContainer>
</template>
