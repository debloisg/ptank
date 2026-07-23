<script setup lang="ts">
// Renders any single markdown page: news/event/competition/result articles
// and standalone pages (content/a-propos.md).
const route = useRoute()

// Pick the collection from the first path segment (Phase 0 split); top-level
// pages like /a-propos fall back to the `pages` collection.
const COLLECTION_BY_SEGMENT = {
  actualites: 'news',
  evenements: 'events',
  competitions: 'competitions',
  resultats: 'results',
} as const
const segment = route.path.split('/').filter(Boolean)[0] ?? ''
const collection = COLLECTION_BY_SEGMENT[segment as keyof typeof COLLECTION_BY_SEGMENT] ?? 'pages'

const { data: page } = await useAsyncData(`page-${route.path}`, () =>
  queryCollection(collection).path(route.path).first(),
)

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Page introuvable', fatal: true })
}

const formattedDate = computed(() =>
  page.value?.date
    ? new Date(page.value.date).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null,
)

const sections: Record<string, { label: string, to: string }> = {
  actualites: { label: 'Toutes les actualités', to: '/actualites' },
  evenements: { label: 'Tous les événements', to: '/evenements' },
  competitions: { label: 'Toutes les compétitions', to: '/competitions' },
  resultats: { label: 'Tous les résultats', to: '/resultats' },
}
const backLink = computed(() => sections[route.path.split('/').filter(Boolean)[0] ?? ''])

useSeoMeta({
  title: () => (page.value?.title ? `${page.value.title} · La Pétanque Fouesnantaise` : undefined),
  description: () => page.value?.description,
})
</script>

<template>
  <UContainer class="py-12 sm:py-16 max-w-3xl">
    <UButton
      v-if="backLink"
      :to="backLink.to"
      variant="link"
      color="primary"
      icon="i-lucide-arrow-left"
      :label="backLink.label"
      class="mb-6 -ml-2"
    />

    <article class="rounded-2xl border border-default bg-elevated shadow-sm p-6 sm:p-10">
      <UPageHeader :headline="page?.category" :title="page?.title" class="mb-8 pb-6 border-b border-default">
        <template v-if="formattedDate || page?.location" #description>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            <span v-if="formattedDate" class="inline-flex items-center gap-1.5">
              <UIcon name="i-lucide-calendar" class="h-4 w-4" />{{ formattedDate }}
            </span>
            <span v-if="page?.location" class="inline-flex items-center gap-1.5">
              <UIcon name="i-lucide-map-pin" class="h-4 w-4" />{{ page.location }}
            </span>
          </div>
        </template>
      </UPageHeader>

      <ProseImg
        v-if="page?.image"
        :src="page.image"
        :alt="page?.title ?? ''"
        format="auto"
        sizes="sm:100vw md:768px"
        loading="lazy"
        placeholder
        class="w-full rounded-2xl border border-default"
      />

      <ContentRenderer v-if="page" :value="page" class="content-prose mt-8" />
    </article>
  </UContainer>
</template>
