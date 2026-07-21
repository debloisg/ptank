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

</script>

<template>
  <UContainer class="py-14 sm:py-20">
    <UPageHeader :headline="eyebrow" :title="title" :description="subtitle" class="mb-10" />

    <template v-if="items?.length">
      <div v-if="layout === 'rows'" class="divide-y divide-default overflow-hidden rounded-2xl border border-default bg-elevated shadow-sm">
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

      <UBlogPosts v-else :orientation="orientation ?? 'horizontal'" class="lg:gap-y-8">
        <PostCard
          v-for="item in items"
          :key="item.path"
          :to="item.path"
          :title="item.title"
          :description="item.description"
          :date="item.date"
          :category="item.category"
          :image="item.image"
        />
      </UBlogPosts>
    </template>

    <div v-else class="rounded-2xl border border-dashed border-accented bg-elevated/50 px-6 py-12 text-center">
      <UIcon name="i-lucide-inbox" class="mx-auto mb-3 h-8 w-8 text-dimmed" />
      <p class="text-muted">{{ empty ?? 'Le contenu publié depuis Nuxt Studio apparaîtra ici.' }}</p>
    </div>

    <UPageCTA
      class="mt-10"
      title="Prêt à jouer avec nous ?"
      description="Contactez le club pour une séance d'essai ou une adhésion."
      :links="[{ label: 'Nous rejoindre', to: '/contact', color: 'secondary', trailingIcon: 'i-lucide-arrow-right' }]"
    />
  </UContainer>
</template>
