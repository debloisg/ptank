<script setup lang="ts">
// Renders any single markdown page: news/event/competition/result articles
// and standalone pages (content/a-propos.md).
const route = useRoute()

// Shape gate before any D1 query: vulnerability scanners spray hundreds of
// probe paths (/wp-json, /.env, /_profiler/…) and every one of them used to
// fall through to this catch-all, query the database and SSR the error page.
// Same belt-to-braces pattern as archives/[year].vue.
//
// The segment list duplicates COLLECTION_BY_SEGMENT below on purpose:
// definePageMeta is a build-time macro compiled out of the component and cannot
// reference file-scope bindings. Keep the two in sync.
//
// Accepted shapes (checked against app/pages/ and content/):
//   /<slug>                          standalone pages collection (/a-propos —
//                                    kept open so Studio can add root pages
//                                    without a deploy)
//   /<section>/<slug>                the four dated collections
//   /archives/<4-digit year>/<slug>  imported Joomla articles
definePageMeta({
  validate: (route) => {
    const slug = /^[a-z0-9][a-z0-9-]*$/
    const segs = Array.isArray(route.params.slug)
      ? route.params.slug
      : [String(route.params.slug ?? '')]
    if (segs.length === 1) return slug.test(segs[0]!)
    if (segs.length === 2)
      return ['actualites', 'evenements', 'competitions', 'resultats'].includes(segs[0]!)
        && slug.test(segs[1]!)
    if (segs.length === 3)
      return segs[0] === 'archives' && /^\d{4}$/.test(segs[1]!) && slug.test(segs[2]!)
    return false
  },
})

// Pick the collection from the first path segment (Phase 0 split); top-level
// pages like /a-propos fall back to the `pages` collection.
const COLLECTION_BY_SEGMENT = {
  actualites: 'news',
  evenements: 'events',
  competitions: 'competitions',
  resultats: 'results',
  // Imported Joomla articles, at /archives/<year>/<slug>. The static
  // /archives, /archives/[year] and /archives/galerie routes take precedence
  // over this catch-all, so only two-segment archive paths land here.
  archives: 'archives',
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
// Archives are the one section whose listing is per-year, so the back link has to
// be derived from the article rather than looked up from a fixed table.
const isArchive = computed(() => segment === 'archives')
// `year` exists on the archives collection only, and this page renders every
// collection — narrow with `in` rather than reaching for `any` (same reason as
// `location` above).
const archiveYear = computed(() =>
  page.value && 'year' in page.value ? (page.value.year as number | undefined) : undefined,
)
const backLink = computed(() => {
  if (isArchive.value) {
    const year = archiveYear.value
    return year
      ? { label: `Archives ${year}`, to: `/archives/${year}` }
      : { label: 'Toutes les archives', to: '/archives' }
  }
  return sections[route.path.split('/').filter(Boolean)[0] ?? '']
})

// Per-article social image: the article's own photo, served raw from R2 —
// same policy as the galerie album pages. Deliberately NOT a /cdn-cgi/image
// crop: only the homepage og keeps a transformation (see nuxt.config.ts), so
// article publishing never depends on the transformation quota. Trade-off
// accepted: it's WebP (a few older scrapers prefer JPEG) and not cropped to
// the 1200x630 OG canvas — scrapers crop to their own canvas anyway.
const r2Base = useRuntimeConfig().public.imageR2Base
const ogImage = computed(() =>
  page.value?.image ? `${r2Base}${page.value.image}` : undefined,
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
  <!-- Archives get a wider measure: their imported tables are far wider than the
       3xl prose column the hand-written pages are set to. -->
  <UContainer class="py-12 sm:py-16" :class="isArchive ? 'max-w-5xl' : 'max-w-3xl'">
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
        sizes="100vw sm:768px"
        loading="eager"
        fetchpriority="high"
        class="w-full aspect-[4/3] sm:aspect-video object-cover rounded-2xl border border-default bg-muted"
      />

      <!-- Tells the reader why the layout and tone differ from the rest of the
           site: these pages are a verbatim import, typos and shouty caps
           included, not something the club wrote today. -->
      <UAlert
        v-if="isArchive"
        color="neutral"
        variant="subtle"
        icon="i-lucide-archive"
        class="mt-8"
        title="Article d'archive"
        description="Cette page provient de l'ancien site du club et est conservée telle quelle. Sa mise en forme peut différer du reste du site."
      />

      <ContentRenderer
        v-if="page"
        :value="page"
        class="content-prose mt-8"
        :class="isArchive ? 'content-prose--archive' : undefined"
      />
    </article>
  </UContainer>
</template>
