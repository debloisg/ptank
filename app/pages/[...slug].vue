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
// True for the dated collections, false for standalone pages like /a-propos.
const isArticle = segment in COLLECTION_BY_SEGMENT
const collection = COLLECTION_BY_SEGMENT[segment as keyof typeof COLLECTION_BY_SEGMENT] ?? 'pages'

const { data: page } = await useAsyncData(`page-${route.path}`, () =>
  queryCollection(collection).path(route.path).first(),
)

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Page introuvable', fatal: true })
}

// `location` exists on the events/competitions/results collections but not on
// news, and this page renders all of them — so narrow with `in` rather than
// reaching for `any`.
const location = computed(() =>
  page.value && 'location' in page.value ? page.value.location : undefined,
)

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

// Per-article social image: crop the article's own photo to the 1200x630 OG
// canvas through Cloudflare Image Transformations, so a shared article previews
// with its own picture instead of the site-wide default set in nuxt.config.
// f=jpeg because social scrapers don't negotiate AVIF/WebP.
const siteConfig = useSiteConfig()
const r2Base = useRuntimeConfig().public.imageR2Base
const ogImage = computed(() =>
  page.value?.image
    ? `${siteConfig.url}/cdn-cgi/image/w=1200,h=630,fit=cover,f=jpeg,q=80/${r2Base}${page.value.image}`
    : undefined,
)

useSeoMeta({
  title: () => (page.value?.title ? `${page.value.title} · Pétanque Fouesnantaise` : undefined),
  description: () => page.value?.description,
  ogImage: () => ogImage.value,
  twitterImage: () => ogImage.value,
  ogType: () => (isArticle ? 'article' : 'website'),
  articlePublishedTime: () => page.value?.date,
})

// Event structured data for the dated collections that describe a real gathering
// — this is what can surface a concours in Google's event results with its date
// and venue. Skipped for news/standalone pages, which aren't events.
if (segment === 'evenements' || segment === 'competitions') {
  useSchemaOrg([
    defineEvent({
      name: () => page.value?.title,
      description: () => page.value?.description,
      startDate: () => page.value?.date,
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: {
        '@type': 'Place',
        'name':
          page.value && 'location' in page.value
            ? (page.value.location as string) || 'Boulodrome de Fouesnant'
            : 'Boulodrome de Fouesnant',
        'address': {
          streetAddress: "Allée de Loc'Hilaire",
          addressLocality: 'Fouesnant',
          postalCode: '29170',
          addressCountry: 'FR',
        },
      },
      organizer: {
        '@type': 'Organization',
        'name': 'Pétanque Fouesnantaise',
        'url': 'https://petanque-fouesnantaise.fr',
      },
      image: () => ogImage.value,
    }),
  ])
}
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
        <template v-if="formattedDate || location" #description>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            <span v-if="formattedDate" class="inline-flex items-center gap-1.5">
              <UIcon name="i-lucide-calendar" class="h-4 w-4" />{{ formattedDate }}
            </span>
            <span v-if="location" class="inline-flex items-center gap-1.5">
              <UIcon name="i-lucide-map-pin" class="h-4 w-4" />{{ location }}
            </span>
          </div>
        </template>
      </UPageHeader>

      <!-- Fixed aspect box + object-cover so the article never reflows while the
           image decodes (CLS). Studio uploads carry no dimensions in frontmatter,
           so the ratio can't come from the content — hence a fixed 4/3 on mobile,
           16/9 from sm up. Portrait uploads are cropped to fit, by design.
           Eager + high priority because this is the page's LCP element. -->
      <ProseImg
        v-if="page?.image"
        :src="page.image"
        :alt="page?.title ?? ''"
        format="auto"
        sizes="sm:100vw md:768px"
        loading="eager"
        fetchpriority="high"
        placeholder
        class="w-full aspect-[4/3] sm:aspect-video object-cover rounded-2xl border border-default"
      />

      <ContentRenderer v-if="page" :value="page" class="content-prose mt-8" />
    </article>
  </UContainer>
</template>
