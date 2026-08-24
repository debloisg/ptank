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

// One card of the feed, precomputed so the template stays declarative.
interface FeedCard {
  value: string
  event: ArchiveEvent
  dateLabel: string
  metaLabel: string | null
  badgeLabel: string
  /** Albums/documents carry the clay accent; everything else stays neutral. */
  isVisual: boolean
}

const { data } = await useAsyncData('archives-hub', async () => {
  const [cfg, articles, albums] = await Promise.all([
    queryCollection('sections').path('/archives').first(),
    // `image` is included so a row can show the article's hero thumbnail. It adds
    // ~240 short paths to the payload, which is worth it — without them the feed
    // is a wall of text next to the albums' thumbnail strips.
    queryCollection('archives')
      .select('path', 'title', 'year', 'category', 'date', 'journal', 'image', 'description')
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

// The chip on each card names the kind of thing in the singular — TYPE_LABELS
// above stays plural because it counts ("Journaux (192)").
const BADGE_LABELS: Record<string, string> = {
  journal: 'Journal',
  competition: 'Compétition',
  album: 'Photos',
  documents: 'Documents',
  calendar: 'Calendrier',
  club: 'Vie du club',
  article: 'Article',
  flash: 'Flash info',
}

// The feed grouped by year, one group per section: the year pill is `sticky`
// inside its group, so the current year stays pinned under the header while its
// cards scroll past, then hands over to the next year — each pill needs its own
// containing block for that, which a flat item list can't provide. Groups are
// built after slicing, so pills never consume a page's quota.
const feedGroups = computed(() => {
  const groups: Array<{ year: number, cards: FeedCard[] }> = []
  for (const event of visibleFeed.value) {
    let group = groups[groups.length - 1]
    if (!group || group.year !== event.year) {
      group = { year: event.year, cards: [] }
      groups.push(group)
    }
    group.cards.push({
      value: event.id,
      event,
      dateLabel: formatEventDate(event),
      // The card's subtitle: how many photos for an album, the category for an
      // article.
      metaLabel: event.photoCount
        ? event.type === 'documents'
          ? `${event.photoCount} élément${event.photoCount > 1 ? 's' : ''} ajouté${event.photoCount > 1 ? 's' : ''} à l'album`
          : `${event.photoCount} photo${event.photoCount > 1 ? 's' : ''} ajoutée${event.photoCount > 1 ? 's' : ''} à l'album`
        : event.category ?? null,
      badgeLabel: BADGE_LABELS[event.type] ?? event.type,
      isVisual: event.type === 'album' || event.type === 'documents',
    })
  }
  return groups
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

        <!-- One thin rail drawn as a pseudo-element on the wrapper; each card
             gets a small dot (clay for photo albums, navy for everything else)
             and each year a pill sitting ON the rail. The pill is sticky INSIDE
             its year's section, so the current year stays pinned under the app
             header while its cards scroll past, then yields to the next one. -->
        <div
          class="relative mt-8 before:absolute before:inset-y-3 before:left-[7px] before:w-0.5 before:bg-accented sm:mt-10"
        >
          <section
            v-for="group in feedGroups"
            :key="group.year"
            class="relative pb-6 last:pb-0 sm:pb-8"
          >
            <!-- `pointer-events-none` on the sticky wrapper: it is a full-width
                 block floating over the cards once stuck, and must not eat their
                 clicks — only the pill itself stays interactive. -->
            <div class="pointer-events-none sticky top-20 z-10 mb-5 sm:mb-7">
              <UBadge
                color="neutral"
                variant="outline"
                size="lg"
                class="pointer-events-auto gap-2.5 rounded-full bg-elevated py-1.5 pl-4 pr-5 shadow-sm"
              >
                <span class="size-2 rounded-full bg-secondary" />
                <span class="font-serif text-lg font-bold tabular-nums text-highlighted">{{ group.year }}</span>
              </UBadge>
            </div>

            <ol class="space-y-5 ps-7 sm:space-y-7 sm:ps-12">
              <li v-for="card in group.cards" :key="card.value" class="relative">
                <!-- Rail dot, vertically aligned with the card's badge line. The
                     arbitrary lefts centre the 12px dot on the rail (rail centre
                     is 8px from the wrapper's left edge; the list's padding is
                     28px / 48px). -->
                <span
                  class="absolute top-6 -left-[26px] size-3 rounded-full sm:-left-[46px]"
                  :class="card.isVisual ? 'bg-secondary' : 'bg-primary'"
                />

                <UPageCard
                  :to="card.event.to"
                  variant="outline"
                  :title="card.event.title"
                  :ui="{
                    root: 'rounded-2xl bg-elevated shadow-sm transition-all duration-200 hover:border-primary/40 hover:shadow-md',
                    // `min-w-0` on both flex layers: the theme's container is
                    // `flex-1` (min-width:auto), so without it the card refuses
                    // to shrink below its content's min-content width and
                    // overflows the viewport on phones.
                    container: 'min-w-0 p-5 sm:p-6 gap-2.5',
                    wrapper: 'min-w-0',
                    title: 'font-serif text-xl font-semibold leading-snug text-highlighted wrap-anywhere sm:text-2xl',
                    footer: 'pt-0',
                  }"
                >
                  <template #header>
                    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <UBadge
                        :color="card.isVisual ? 'secondary' : 'neutral'"
                        variant="subtle"
                        size="sm"
                        :icon="card.event.icon"
                        class="rounded-full !text-[0.65rem] font-semibold uppercase tracking-wide"
                      >
                        {{ card.badgeLabel }}
                      </UBadge>
                      <span class="text-xs tabular-nums text-muted">{{ card.dateLabel }}</span>
                    </div>
                  </template>

                  <!-- `wrap-anywhere` (overflow-wrap:anywhere): some imported
                       descriptions are one giant unbroken word (e.g.
                       "FEDERATIONFRANCAISEde…"), and unlike break-word this also
                       shrinks the text's min-content — without it the word
                       propagates its full width up the flex chain and pushes the
                       whole card past the viewport on phones. -->
                  <template #description>
                    <span v-if="card.metaLabel" class="block text-sm text-muted wrap-anywhere">{{ card.metaLabel }}</span>
                    <span v-if="card.event.description" class="mt-1.5 line-clamp-2 block text-sm text-toned wrap-anywhere">
                      {{ card.event.description }}
                    </span>
                  </template>

                  <template #footer>
                    <!-- Albums show a strip of that year's photos; an article
                         shows its hero image. Fixed small boxes that wrap, so
                         the strip can never overflow the card. -->
                    <div v-if="card.event.thumbs?.length" class="flex flex-wrap gap-2 sm:gap-3">
                      <NuxtImg
                        v-for="thumb in card.event.thumbs"
                        :key="thumb.src"
                        :src="thumb.src"
                        :alt="thumb.alt"
                        :width="thumb.w"
                        :height="thumb.h"
                        loading="lazy"
                        class="h-24 w-32 rounded-lg border border-default bg-muted object-cover sm:h-28 sm:w-40"
                      />
                    </div>
                    <!-- No width/height: article frontmatter carries no
                         dimensions, and the fixed CSS box already reserves the
                         space, so there's no CLS to guard against here. `sizes`
                         keeps 1600px heroes off a 160px box. -->
                    <NuxtImg
                      v-else-if="card.event.image"
                      :src="card.event.image"
                      :alt="card.event.title"
                      sizes="320px"
                      loading="lazy"
                      class="h-24 w-32 rounded-lg border border-default bg-muted object-cover sm:h-28 sm:w-40"
                    />

                    <span class="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                      {{ card.isVisual ? "Voir l'album" : 'Lire la suite' }}
                      <UIcon name="i-lucide-arrow-right" class="size-4" />
                    </span>
                  </template>
                </UPageCard>
              </li>
            </ol>
          </section>
        </div>

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
