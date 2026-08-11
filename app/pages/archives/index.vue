<script setup lang="ts">
// Archive hub: the entry point into the 244 articles recovered from the old
// Joomla site (2008-2026) and the 34 photo albums.
//
// Three dispositions of the same material, switchable (choice persisted):
//   chronologie — a timeline, latest year first, each year mixing the articles
//                 published then with the albums holding photos from it. This is
//                 the default: an archive's natural axis is time.
//   années      — a compact grid of year cards grouped by decade. Fastest way to
//                 jump straight to a known year.
//   liste       — every article as one flat list, newest first.
// Search sits above all three and replaces them while active.
//
// The heading copy lives in content/archives.md so it stays Studio-editable.
import type { ArchiveEvent } from '~/utils/archives'
import { buildArchiveFeed, formatEventDate } from '~/utils/archives'

// The feed renders two kinds of row through one UTimeline. `isYear` is a literal
// discriminant so the template narrows on `v-if="item.isYear"` / `v-else` and
// `item.event` stays fully typed in the second branch.
type FeedRow =
  | { value: string, icon: string, title: string, isYear: true, year: number }
  | {
    value: string
    icon: string
    title: string
    isYear: false
    event: ArchiveEvent
    dateLabel: string
    metaLabel: string | null
  }

const { data } = await useAsyncData('archives-hub', async () => {
  const [cfg, articles, albums] = await Promise.all([
    queryCollection('sections').path('/archives').first(),
    // `image` is included so a row can show the article's hero thumbnail. It adds
    // ~240 short paths to the payload, which is worth it — without them the feed
    // is a wall of text next to the albums' thumbnail strips.
    queryCollection('archives')
      .select('path', 'title', 'year', 'category', 'date', 'journal', 'image')
      .order('date', 'DESC')
      .all(),
    // `byYear` is a precomputed aggregate — see content.config.ts. Selecting
    // `photos` here would add ~150 KB of payload.
    queryCollection('galerie').select('key', 'title', 'kind', 'count', 'byYear').all(),
  ])
  return { cfg, articles, albums }
})

const cfg = computed(() => data.value?.cfg ?? null)
const articles = computed(() => data.value?.articles ?? [])
const albums = computed(() => data.value?.albums ?? [])

// ── Stats strip ─────────────────────────────────────────────────────────────
const photoCount = computed(() => albums.value.reduce((sum, a) => sum + a.count, 0))
const yearRange = computed(() => {
  const years = articles.value.map(a => a.year).filter(Boolean)
  if (!years.length) return null
  return { from: Math.min(...years), to: Math.max(...years) }
})
const stats = computed(() => [
  { value: String(articles.value.length), label: 'articles' },
  { value: yearRange.value ? `${yearRange.value.from}–${yearRange.value.to}` : '—', label: 'de vie du club' },
  { value: String(photoCount.value), label: 'photos' },
  { value: String(albums.value.length), label: 'albums' },
])

// ── Chronologie: one flat, date-sorted stream ───────────────────────────────
const feed = computed(() => buildArchiveFeed(articles.value, albums.value))

// 400+ events is too many to render at once; reveal them in pages. `feedShown`
// resets whenever the type filter changes so a narrowed feed starts from the top.
const FEED_PAGE = 50
const feedShown = ref(FEED_PAGE)

// Filter the stream by kind of thing. `null` = everything.
const typeFilter = ref<string | null>(null)
const TYPE_LABELS: Record<string, { label: string, icon: string }> = {
  journal: { label: 'Journaux', icon: 'i-lucide-newspaper' },
  competition: { label: 'Compétitions', icon: 'i-lucide-trophy' },
  album: { label: 'Albums photos', icon: 'i-lucide-images' },
  documents: { label: 'Documents', icon: 'i-lucide-file-stack' },
  calendar: { label: 'Calendriers', icon: 'i-lucide-calendar-days' },
  club: { label: 'Vie du club', icon: 'i-lucide-users' },
  article: { label: 'Autres articles', icon: 'i-lucide-file-text' },
  flash: { label: 'Flash infos', icon: 'i-lucide-zap' },
}
const typeCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const event of feed.value) counts.set(event.type, (counts.get(event.type) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count, ...(TYPE_LABELS[type] ?? { label: type, icon: 'i-lucide-dot' }) }))
})

const filteredFeed = computed(() =>
  typeFilter.value ? feed.value.filter(e => e.type === typeFilter.value) : feed.value,
)

const visibleFeed = computed(() => filteredFeed.value.slice(0, feedShown.value))

// Only `icon` (the rail indicator) and the row data are passed through: the whole
// row is rendered from the #title slot as a single card, so `date`/`description`
// are deliberately absent — UTimeline renders those slots only when the item has
// the matching key, and splitting the row across three slots would put the date
// and the thumbnails outside the card.
//
// Each year gets its OWN row rather than a label stacked above the first card of
// the year. The rail indicator aligns to the top of an item's wrapper, so a label
// sitting above the card pushed the card away from its own icon — the icon then
// read as belonging to the year, and the card looked like it had none.
// Year rows are inserted after slicing, so they never consume a page's quota.
const feedItems = computed(() => {
  const items: FeedRow[] = []
  let lastYear: number | null = null
  for (const event of visibleFeed.value) {
    if (event.year !== lastYear) {
      items.push({
        value: `year-${event.year}`,
        icon: 'i-lucide-calendar',
        title: String(event.year),
        isYear: true,
        year: event.year,
      })
      lastYear = event.year
    }
    items.push({
      value: event.id,
      icon: event.icon,
      title: event.title,
      isYear: false,
      event,
      dateLabel: formatEventDate(event),
      // The row's second meta fact, beside the date: how many photos for an album,
      // the category for an article. Precomputed so the template doesn't have to
      // branch three ways around the responsive date.
      metaLabel: event.photoCount
        ? `${event.photoCount} ${event.type === 'documents' ? 'élément' : 'photo'}${event.photoCount > 1 ? 's' : ''}`
        : event.category ?? null,
    })
  }
  return items
})

function setTypeFilter(type: string | null) {
  typeFilter.value = type
  feedShown.value = FEED_PAGE
}

// ── Années (decade grid) ────────────────────────────────────────────────────
const byYear = computed(() => {
  const map = new Map<number, { year: number, total: number, journals: number, photos: number }>()
  for (const event of feed.value) {
    const entry = map.get(event.year) ?? { year: event.year, total: 0, journals: 0, photos: 0 }
    if (event.type === 'album' || event.type === 'documents') entry.photos += event.photoCount ?? 0
    else {
      entry.total += 1
      if (event.type === 'journal') entry.journals += 1
    }
    map.set(event.year, entry)
  }
  return [...map.values()].sort((a, b) => b.year - a.year)
})

const DECADE_LABELS: Record<number, string> = {
  2000: 'Les débuts du site',
  2010: 'Années 2010',
  2020: 'Années 2020',
}
const decades = computed(() => {
  const groups = new Map<number, typeof byYear.value>()
  for (const entry of byYear.value) {
    const decade = Math.floor(entry.year / 10) * 10
    groups.set(decade, [...(groups.get(decade) ?? []), entry])
  }
  return [...groups.entries()]
    .map(([decade, years]) => ({
      decade,
      label: DECADE_LABELS[decade] ?? `Années ${decade}`,
      years,
      total: years.reduce((sum, y) => sum + y.total, 0),
    }))
    .sort((a, b) => b.decade - a.decade)
})

// ── Disposition switcher ────────────────────────────────────────────────────
type Disposition = 'timeline' | 'years' | 'list'
const disposition = useState<Disposition>('archives-disposition', () => 'timeline')
const dispositions = [
  { value: 'timeline' as const, label: 'Chronologie', icon: 'i-lucide-milestone' },
  { value: 'years' as const, label: 'Années', icon: 'i-lucide-grid-3x3' },
  { value: 'list' as const, label: 'Liste', icon: 'i-lucide-list' },
]

// ── Search ──────────────────────────────────────────────────────────────────
const query = ref('')
// "No category filter" is the ABSENCE of a value, shown via the placeholder —
// reka-ui throws on a ComboboxItem whose value is '', so a sentinel "all" item is
// not available. Nullable too: the select's `clear` button resets to `null`.
const selectedCategory = ref<string | null | undefined>(undefined)

const categories = computed(() => {
  const counts = new Map<string, number>()
  for (const article of articles.value) {
    if (!article.category) continue
    counts.set(article.category, (counts.get(article.category) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))
    .map(([label, count]) => ({ label: `${label} (${count})`, value: label }))
})

// Accent- and case-insensitive: nobody types "Compétitions" with the accent when
// searching, and half the imported titles are in shouty caps.
function fold(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

const isFiltering = computed(() => query.value.trim().length > 0 || Boolean(selectedCategory.value))

const results = computed(() => {
  if (!isFiltering.value) return []
  const needle = fold(query.value.trim())
  return articles.value.filter((article) => {
    if (selectedCategory.value && article.category !== selectedCategory.value) return false
    if (!needle) return true
    const haystack = fold(`${article.title ?? ''} ${article.category ?? ''} ${article.journal ?? ''}`)
    return haystack.includes(needle)
  })
})

// Capped so a bare category filter (up to 192 journals) can't render a wall of
// rows; the count above always reports the true total.
const RESULT_LIMIT = 60
const visibleResults = computed(() => results.value.slice(0, RESULT_LIMIT))

function resetFilters() {
  query.value = ''
  selectedCategory.value = undefined
}

useSeoMeta({
  title: () => `${cfg.value?.title ?? 'Archives'} · Pétanque Fouesnantaise`,
  description: () =>
    cfg.value?.description
    ?? 'Les archives du club : journaux mensuels, compétitions et albums photos depuis 2008.',
})
</script>

<template>
  <UContainer class="py-14 sm:py-20">
    <UPageHeader
      :headline="cfg?.eyebrow ?? 'La mémoire du club'"
      :title="cfg?.title ?? 'Archives'"
      :description="cfg?.description"
    />

    <!-- Stats strip: the scale of the archive, up front. Tabular numerals so the
         four figures line up on their baselines. -->
    <dl class="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-default bg-accented sm:grid-cols-4">
      <div v-for="stat in stats" :key="stat.label" class="bg-elevated px-5 py-6 text-center">
        <dt class="sr-only">{{ stat.label }}</dt>
        <dd>
          <span class="block font-serif text-2xl font-bold tabular-nums text-primary sm:text-3xl">
            {{ stat.value }}
          </span>
          <span class="mt-1 block text-xs uppercase tracking-[0.14em] text-muted">{{ stat.label }}</span>
        </dd>
      </div>
    </dl>

    <!-- ── Search ────────────────────────────────────────────────────────── -->
    <section class="mt-12" aria-labelledby="archives-search-heading">
      <h2 id="archives-search-heading" class="sr-only">Chercher dans les archives</h2>
      <div class="flex flex-col gap-3 sm:flex-row">
        <UInput
          v-model="query"
          icon="i-lucide-search"
          placeholder="Chercher un article, un mois, une compétition…"
          size="lg"
          class="flex-1"
          aria-label="Rechercher un article dans les archives"
          :ui="{ root: 'w-full' }"
        />
        <USelectMenu
          v-model="selectedCategory"
          :items="categories"
          value-key="value"
          :search-input="false"
          clear
          placeholder="Toutes les catégories"
          size="lg"
          class="sm:w-72"
          aria-label="Filtrer par catégorie"
        />
        <UButton
          v-if="isFiltering"
          color="neutral"
          variant="subtle"
          size="lg"
          icon="i-lucide-x"
          label="Effacer"
          @click="resetFilters"
        />
      </div>

      <div v-if="isFiltering" class="mt-6">
        <p class="mb-3 text-sm text-muted">
          <template v-if="results.length">
            {{ results.length }} article{{ results.length > 1 ? 's' : '' }} trouvé{{ results.length > 1 ? 's' : '' }}
            <template v-if="results.length > RESULT_LIMIT">
              — les {{ RESULT_LIMIT }} plus récents sont affichés
            </template>
          </template>
          <template v-else>Aucun article ne correspond.</template>
        </p>
        <div
          v-if="visibleResults.length"
          class="divide-y divide-default overflow-hidden rounded-2xl border border-default bg-elevated shadow-sm"
        >
          <ArchiveRow
            v-for="article in visibleResults"
            :key="article.path"
            :to="article.path"
            :title="article.title"
            :date="article.date"
            :category="article.category"
            :journal="article.journal"
            :year="article.year"
            show-year
          />
        </div>
      </div>
    </section>

    <!-- Everything below answers "what is in here"; the search above answers
         "where is this one thing". Showing both at once doubles the page. -->
    <template v-if="!isFiltering">
      <div class="mt-12 flex flex-wrap items-center justify-between gap-3">
        <div
          class="inline-flex rounded-full border border-default bg-elevated p-1 shadow-sm"
          role="group"
          aria-label="Disposition des archives"
        >
          <UButton
            v-for="option in dispositions"
            :key="option.value"
            :icon="option.icon"
            :label="option.label"
            :color="disposition === option.value ? 'primary' : 'neutral'"
            :variant="disposition === option.value ? 'solid' : 'ghost'"
            size="sm"
            class="rounded-full"
            :aria-pressed="disposition === option.value"
            @click="disposition = option.value"
          />
        </div>

        <UButton
          to="/archives/galerie"
          color="secondary"
          variant="subtle"
          icon="i-lucide-images"
          label="Toute la galerie"
          class="rounded-full"
        />
      </div>

      <!-- ── Chronologie: one flat stream, newest first ───────────────────── -->
      <template v-if="disposition === 'timeline'">
        <!-- Type filter. Each kind of archived thing keeps the same icon here as
             on its rows, so the legend and the stream teach each other. -->
        <div class="mt-6 flex flex-wrap items-center gap-2">
          <UButton
            label="Tout"
            :color="typeFilter === null ? 'primary' : 'neutral'"
            :variant="typeFilter === null ? 'soft' : 'ghost'"
            size="xs"
            class="rounded-full"
            @click="setTypeFilter(null)"
          />
          <UButton
            v-for="entry in typeCounts"
            :key="entry.type"
            :icon="entry.icon"
            :label="`${entry.label} (${entry.count})`"
            :color="typeFilter === entry.type ? 'primary' : 'neutral'"
            :variant="typeFilter === entry.type ? 'soft' : 'ghost'"
            size="xs"
            class="rounded-full"
            @click="setTypeFilter(entry.type)"
          />
        </div>

        <!-- The row spacing lives on `wrapper`, NOT on `item`: the theme lays the
             item out as `flex` with the indicator+separator `container` beside the
             wrapper, so padding on `item` sits outside the container and the
             `flex-1` separator can't grow into it — which breaks the rail into
             disconnected segments between rows. Padding inside the wrapper makes
             the item taller, the container stretches with it, and the line runs
             continuously from the first row to the last. -->
        <UTimeline
          :items="feedItems"
          orientation="vertical"
          size="3xl"
          color="primary"
          class="mt-8"
          :ui="{
            // `lg:ps-32` reserves a left gutter OUTSIDE the rail. `item` is
            // `relative` in the theme, so the date can be absolutely positioned
            // into that gutter — UTimeline has no slot before the indicator.
            item: 'lg:ps-32',
            wrapper: 'w-full pb-3',
            title: 'font-normal',
            // ── Centering the icon on its card ──────────────────────────────
            // The theme stacks the container as [avatar, separator(flex-1)], so
            // the avatar is pinned to the TOP and the line only exists below it.
            // Simply centering the avatar would therefore tear a gap in the rail
            // above it. So: drop the separator element entirely and draw the rail
            // as a full-height pseudo-element on the container, then centre the
            // avatar over it. `group-first`/`group-last` clip the line at the
            // first and last icon so it doesn't overshoot the ends of the list
            // (`group` is on `item` in the theme).
            separator: 'hidden',
            container: [
              'relative justify-center',
              'before:absolute before:inset-y-0 before:left-1/2 before:w-0.5 before:-translate-x-1/2 before:bg-accented',
              'group-first:before:top-1/2 group-last:before:bottom-1/2',
            ].join(' '),
            // size=3xl is the largest the underlying UAvatar offers (size-12 with
            // a text-2xl glyph). `relative z-10` lifts it above the rail line it
            // now sits on top of. `-mt-1.5` compensates for the wrapper's `pb-3`,
            // so the icon centres on the CARD rather than on card-plus-gap.
            indicator: 'relative z-10 -mt-1.5 text-primary bg-elevated ring ring-default',
          }"
        >
          <template #title="{ item }">
            <!-- A year's own row. Its icon lands on the rail like any other, so
                 the content rows below keep theirs aligned to their cards. -->
            <span
              v-if="item.isYear"
              class="block pb-1 font-serif text-3xl font-bold tabular-nums text-primary"
            >{{ item.year }}</span>

            <template v-else>
              <!-- Desktop: the date sits in the gutter to the left of the rail.
                   Below `lg` there is no gutter, so it falls back to the card's
                   meta line (see the `lg:hidden` span there). -->
              <!-- `inset-y-0 pb-3` + `items-center` centres the date on the card
                   the same way the icon is centred (pb-3 mirrors the wrapper's
                   bottom gap), so date, icon and card all share one baseline. -->
              <span
                class="absolute inset-y-0 left-0 hidden w-28 items-center justify-end pb-3 pr-4 text-right text-xs tabular-nums text-dimmed lg:flex"
              >{{ item.dateLabel }}</span>

              <!-- One card per row, whatever the row is. Same shape as the article
                   rows elsewhere in the archive, with an optional thumbnail strip. -->
            <NuxtLink
              :to="item.event.to"
              class="group flex items-center gap-3 rounded-xl border border-default bg-elevated px-3 py-3.5 shadow-sm transition-all duration-200 hover:border-primary/40 hover:shadow-md sm:gap-4 sm:px-4 sm:py-4"
            >
              <!-- Albums show a strip of that year's photos; an article shows its
                   hero image. Both land in the same slot so every row with a
                   picture reads alike. -->
              <span v-if="item.event.thumbs?.length" class="flex shrink-0 gap-1.5">
                <NuxtImg
                  v-for="thumb in item.event.thumbs"
                  :key="thumb.src"
                  :src="thumb.src"
                  :alt="thumb.alt"
                  :width="thumb.w"
                  :height="thumb.h"
                  format="auto"
                  sizes="96px"
                  loading="lazy"
                  class="size-14 rounded-lg border border-default object-cover sm:size-16"
                />
              </span>
              <!-- No width/height: article frontmatter carries no dimensions, and
                   the fixed CSS box already reserves the space, so there's no CLS
                   to guard against here. -->
              <NuxtImg
                v-else-if="item.event.image"
                :src="item.event.image"
                :alt="item.event.title"
                format="auto"
                sizes="96px"
                loading="lazy"
                class="size-14 shrink-0 rounded-lg border border-default object-cover sm:size-16"
              />

              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium text-highlighted transition-colors group-hover:text-primary sm:text-[0.95rem]">
                  {{ item.event.title }}
                </span>
                <span class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                  <span class="tabular-nums lg:hidden">{{ item.dateLabel }}</span>
                  <span v-if="item.metaLabel" class="text-dimmed lg:hidden">·</span>
                  <span v-if="item.metaLabel">{{ item.metaLabel }}</span>
                </span>
              </span>

              <UIcon
                name="i-lucide-chevron-right"
                class="hidden size-4 shrink-0 text-dimmed transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary sm:block"
              />
              </NuxtLink>
            </template>
          </template>
        </UTimeline>

        <div v-if="feedShown < filteredFeed.length" class="mt-6 flex justify-center">
          <UButton
            :label="`Voir plus (${filteredFeed.length - feedShown} restants)`"
            icon="i-lucide-chevron-down"
            color="neutral"
            variant="subtle"
            class="rounded-full"
            @click="feedShown += FEED_PAGE"
          />
        </div>
        <p v-else class="mt-6 text-center text-xs text-dimmed">
          {{ filteredFeed.length }} élément{{ filteredFeed.length > 1 ? 's' : '' }} — fin des archives.
        </p>
      </template>

      <!-- ── Années ──────────────────────────────────────────────────────── -->
      <div v-else-if="disposition === 'years'" class="mt-8">
        <div v-for="decade in decades" :key="decade.decade" class="mt-8 first:mt-0">
          <div class="mb-4 flex items-baseline gap-3">
            <h3 class="text-xs font-semibold uppercase tracking-[0.14em] text-secondary">{{ decade.label }}</h3>
            <span class="text-xs text-dimmed">{{ decade.total }} articles</span>
          </div>

          <UPageGrid class="gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
            <NuxtLink
              v-for="entry in decade.years"
              :key="entry.year"
              :to="`/archives/${entry.year}`"
              class="group flex flex-col justify-between rounded-2xl border border-default bg-elevated p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
            >
              <span class="font-serif text-3xl font-bold tabular-nums text-highlighted transition-colors group-hover:text-primary">
                {{ entry.year }}
              </span>
              <span class="mt-3 space-y-0.5 text-sm text-muted">
                <span class="block">
                  {{ entry.total }} article{{ entry.total > 1 ? 's' : '' }}
                </span>
                <span v-if="entry.journals" class="block text-xs text-dimmed">
                  dont {{ entry.journals }} journal{{ entry.journals > 1 ? 'x' : '' }}
                </span>
                <span v-if="entry.photos" class="block text-xs text-secondary">
                  {{ entry.photos }} photo{{ entry.photos > 1 ? 's' : '' }}
                </span>
              </span>
            </NuxtLink>
          </UPageGrid>
        </div>
      </div>

      <!-- ── Liste ───────────────────────────────────────────────────────── -->
      <div
        v-else
        class="mt-8 divide-y divide-default overflow-hidden rounded-2xl border border-default bg-elevated shadow-sm"
      >
        <ArchiveRow
          v-for="article in articles"
          :key="article.path"
          :to="article.path"
          :title="article.title"
          :date="article.date"
          :category="article.category"
          :journal="article.journal"
          :year="article.year"
          show-year
        />
      </div>
    </template>
  </UContainer>
</template>
