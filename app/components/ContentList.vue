<script setup lang="ts">
// Lists every markdown file inside a folder (ex: /actualites) — most recent
// first. `layout` picks card grid (news/results) or agenda rows (events/comps).
const props = defineProps<{
  prefix: string
  eyebrow?: string
  title: string
  subtitle?: string
  layout?: 'cards' | 'rows'
  empty?: string
}>()

const { data: items } = await useAsyncData(`list-${props.prefix}`, () =>
  queryCollection('content')
    .where('path', 'LIKE', `${props.prefix}/%`)
    .order('date', 'DESC')
    .all(),
)
</script>

<template>
  <UContainer class="py-14 sm:py-20">
    <SectionHeader :eyebrow="eyebrow" :title="title" :subtitle="subtitle" />

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

      <div v-else class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <ArticleCard
          v-for="item in items"
          :key="item.path"
          :to="item.path"
          :title="item.title"
          :description="item.description"
          :date="item.date"
          :image="item.image"
          :location="item.location"
          :category="item.category"
        />
      </div>
    </template>

    <div v-else class="rounded-2xl border border-dashed border-accented bg-elevated/50 px-6 py-12 text-center">
      <UIcon name="i-lucide-inbox" class="mx-auto mb-3 h-8 w-8 text-dimmed" />
      <p class="text-muted">{{ empty ?? 'Le contenu publié depuis Nuxt Studio apparaîtra ici.' }}</p>
    </div>
  </UContainer>
</template>
