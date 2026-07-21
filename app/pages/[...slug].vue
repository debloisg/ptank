<script setup lang="ts">
// Renders any single markdown page: news/event/competition/result articles
// and standalone pages (content/a-propos.md).
const route = useRoute()
const { siteUrl, siteName, toAbsoluteUrl } = useSiteSeo()

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

const canonicalUrl = computed(() => toAbsoluteUrl(route.path) || siteUrl.value)
const pageImageUrl = computed(() => toAbsoluteUrl(page.value?.image))

const detailSchema = computed<Record<string, unknown> | null>(() => {
  if (!page.value)
    return null

  if (collection === 'news') {
    return {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: page.value.title,
      description: page.value.description,
      datePublished: page.value.date,
      image: pageImageUrl.value ? [pageImageUrl.value] : undefined,
      inLanguage: 'fr-FR',
      mainEntityOfPage: canonicalUrl.value,
      author: {
        '@type': 'SportsOrganization',
        name: siteName,
        url: siteUrl.value,
      },
      publisher: {
        '@type': 'SportsOrganization',
        name: siteName,
        url: siteUrl.value,
      },
    }
  }

  if (collection === 'events' || collection === 'competitions') {
    return {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: page.value.title,
      description: page.value.description,
      startDate: page.value.date,
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      eventStatus: 'https://schema.org/EventScheduled',
      location: page.value.location
        ? {
            '@type': 'Place',
            name: page.value.location,
          }
        : undefined,
      image: pageImageUrl.value ? [pageImageUrl.value] : undefined,
      url: canonicalUrl.value,
      organizer: {
        '@type': 'SportsOrganization',
        name: siteName,
        url: siteUrl.value,
      },
    }
  }

  return null
})

useHead(() => ({
  link: [{ rel: 'canonical', href: canonicalUrl.value }],
  script: detailSchema.value
    ? [
        {
          key: 'ld-detail',
          type: 'application/ld+json',
          children: JSON.stringify(detailSchema.value),
        },
      ]
    : [],
}))

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
      <UPageHeader :headline="page?.category" :title="page?.title" class="mb-8">
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

      <img
        v-if="page?.image"
        :src="page.image"
        :alt="page?.title"
        class="w-full rounded-2xl border border-default"
      >

      <ContentRenderer v-if="page" :value="page" class="content-prose mt-8" />

      <UPageCTA
        class="mt-12"
        title="Envie de rejoindre le club ?"
        description="Venez nous rencontrer et participer à la vie de La Pétanque Fouesnantaise."
        :links="[{ label: 'Nous rejoindre', to: '/contact', color: 'secondary', trailingIcon: 'i-lucide-arrow-right' }]"
      />
    </article>
  </UContainer>
</template>
