<script setup lang="ts">
// Renders any single markdown page: news/event/competition/result articles
// and standalone pages (content/a-propos.md).
const route = useRoute()

const { data: page } = await useAsyncData(`page-${route.path}`, () =>
  queryCollection('content').path(route.path).first(),
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

    <article>
      <div v-if="page?.category || formattedDate || page?.location" class="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span v-if="page?.category" class="eyebrow">{{ page.category }}</span>
        <span v-if="formattedDate" class="inline-flex items-center gap-1.5">
          <UIcon name="i-lucide-calendar" class="h-4 w-4" />{{ formattedDate }}
        </span>
        <span v-if="page?.location" class="inline-flex items-center gap-1.5">
          <UIcon name="i-lucide-map-pin" class="h-4 w-4" />{{ page.location }}
        </span>
      </div>

      <h1 class="font-serif text-4xl sm:text-5xl font-semibold leading-tight tracking-tight text-highlighted">
        {{ page?.title }}
      </h1>

      <img
        v-if="page?.image"
        :src="page.image"
        :alt="page?.title"
        class="mt-8 w-full rounded-2xl border border-default"
      >

      <ContentRenderer v-if="page" :value="page" class="content-prose mt-8" />
    </article>
  </UContainer>
</template>
