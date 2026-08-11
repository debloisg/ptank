<script setup lang="ts">
// One archive year: /archives/2015.
//
// Route shape note — this page sits alongside /archives/galerie and the
// catch-all [...slug].vue that renders the articles themselves
// (/archives/2015/journal-2015-05). Vue Router prefers the static `galerie`
// segment over this dynamic one, and this page only matches a single segment, so
// article paths fall through to the catch-all. The `validate` below is the belt
// to that braces: anything that isn't a 4-digit year 404s here instead of
// rendering an empty year.
const route = useRoute()

definePageMeta({
  validate: route => /^\d{4}$/.test(String(route.params.year)),
})

const year = computed(() => Number(route.params.year))

const { data } = await useAsyncData(`archives-year-${route.params.year}`, async () => {
  const [articles, years] = await Promise.all([
    queryCollection('archives')
      .where('year', '=', Number(route.params.year))
      .order('date', 'ASC')
      .all(),
    // Every distinct year that actually has content, for the prev/next stepper —
    // the range has gaps and hardcoding year±1 would produce dead links.
    queryCollection('archives').select('year').all(),
  ])
  return { articles, years: [...new Set(years.map(y => y.year))].sort((a, b) => a - b) }
})

const articles = computed(() => data.value?.articles ?? [])

if (!articles.value.length) {
  throw createError({ statusCode: 404, statusMessage: 'Aucune archive pour cette année', fatal: true })
}

// The monthly club journal is the backbone of the archive, so it gets its own
// block, ordered by the period it covers rather than by publication date (the
// Joomla dates are unreliable — many issues were back-dated on import in 2013).
const journals = computed(() =>
  articles.value
    .filter(a => a.journal)
    .sort((a, b) => (a.journal ?? '').localeCompare(b.journal ?? '')),
)
const others = computed(() => articles.value.filter(a => !a.journal))

const neighbours = computed(() => {
  const years = data.value?.years ?? []
  const i = years.indexOf(year.value)
  return {
    previous: i > 0 ? years[i - 1] : null,
    next: i >= 0 && i < years.length - 1 ? years[i + 1] : null,
  }
})

useSeoMeta({
  title: () => `Archives ${year.value} · Pétanque Fouesnantaise`,
  description: () =>
    `Les ${articles.value.length} articles et journaux du club publiés en ${year.value}.`,
})
</script>

<template>
  <UContainer class="py-12 sm:py-16">
    <UButton
      to="/archives"
      variant="link"
      color="primary"
      icon="i-lucide-arrow-left"
      label="Toutes les archives"
      class="mb-6 -ml-2"
    />

    <UPageHeader
      headline="La mémoire du club"
      :title="`Archives ${year}`"
      :description="`${articles.length} article${articles.length > 1 ? 's' : ''} publié${articles.length > 1 ? 's' : ''} cette année-là.`"
    />

    <section v-if="journals.length" class="mt-10" aria-labelledby="journaux-heading">
      <h2 id="journaux-heading" class="mb-4 flex items-center gap-2 font-serif text-lg font-semibold text-highlighted">
        <UIcon name="i-lucide-newspaper" class="size-5 text-secondary" />
        Journaux du club
      </h2>
      <div class="divide-y divide-default overflow-hidden rounded-2xl border border-default bg-elevated shadow-sm">
        <ArchiveRow
          v-for="article in journals"
          :key="article.path"
          :to="article.path"
          :title="article.title"
          :date="article.date"
          :category="article.category"
          :journal="article.journal"
        />
      </div>
    </section>

    <section v-if="others.length" class="mt-10" aria-labelledby="articles-heading">
      <h2 id="articles-heading" class="mb-4 flex items-center gap-2 font-serif text-lg font-semibold text-highlighted">
        <UIcon name="i-lucide-file-text" class="size-5 text-dimmed" />
        Autres articles
      </h2>
      <div class="divide-y divide-default overflow-hidden rounded-2xl border border-default bg-elevated shadow-sm">
        <ArchiveRow
          v-for="article in others"
          :key="article.path"
          :to="article.path"
          :title="article.title"
          :date="article.date"
          :category="article.category"
        />
      </div>
    </section>

    <!-- Year stepper: skips the gaps in the range (see `neighbours`). -->
    <nav class="mt-12 flex items-center justify-between gap-4 border-t border-default pt-6" aria-label="Navigation entre les années">
      <UButton
        v-if="neighbours.previous"
        :to="`/archives/${neighbours.previous}`"
        variant="ghost"
        color="neutral"
        icon="i-lucide-chevron-left"
        :label="String(neighbours.previous)"
      />
      <span v-else />
      <UButton
        v-if="neighbours.next"
        :to="`/archives/${neighbours.next}`"
        variant="ghost"
        color="neutral"
        trailing-icon="i-lucide-chevron-right"
        :label="String(neighbours.next)"
      />
      <span v-else />
    </nav>
  </UContainer>
</template>
