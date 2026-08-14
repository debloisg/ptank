<script setup lang="ts">
import { formatAlbumSpan } from '~/utils/gallery'

// Album index for the archive gallery: /archives/galerie.
//
// `.select()` without `photos` is load-bearing — the full catalogue is 1355 photo
// records, and this page needs only the cover of each album. Selecting the whole
// document would ship every photo of every album to the browser to render 34 cards.
const { data: albums } = await useAsyncData('galerie-albums', () =>
  queryCollection('galerie')
    .select('key', 'title', 'kind', 'count', 'cover', 'years', 'dateRange')
    .all(),
)

// Photographs of people and events first; scans, posters and club emblems after.
// Both are worth keeping, but they answer different questions and mixing them
// makes the grid feel like a dumping ground.
const photoAlbums = computed(() =>
  (albums.value ?? []).filter(a => a.kind === 'photos').sort((a, b) => b.count - a.count),
)
const documentAlbums = computed(() =>
  (albums.value ?? []).filter(a => a.kind === 'documents').sort((a, b) => b.count - a.count),
)

const photoCount = computed(() => (albums.value ?? []).reduce((sum, a) => sum + a.count, 0))

// Prefer the span of actual photo dates (EXIF or the article a photo appears in)
// over the years merely inferred from folder names — it's the stronger evidence.
// See formatAlbumSpan for why this reduces to years.
const yearLabel = formatAlbumSpan

useSeoMeta({
  title: 'Galerie photos des archives · Pétanque Fouesnantaise',
  description: () =>
    `${photoCount.value} photos d'archive du club réparties en ${(albums.value ?? []).length} albums, de 2008 à aujourd'hui.`,
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
      title="Galerie photos"
      :description="`${photoCount} photos récupérées de l'ancien site, classées par album.`"
    />

    <section class="mt-10" aria-labelledby="albums-photos-heading">
      <h2 id="albums-photos-heading" class="sr-only">Albums photos</h2>
      <UPageGrid class="sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
        <NuxtLink
          v-for="album in photoAlbums"
          :key="album.key"
          :to="`/archives/galerie/${album.key}`"
          class="group relative overflow-hidden rounded-2xl border border-default bg-elevated shadow-sm transition-shadow duration-200 hover:shadow-md"
        >
          <!-- ~400px grid slot: `sizes` maps to the pre-generated -800 rendition,
               the blur placeholder to its -ph sibling. The skeleton pulses until
               the (opaque, `relative`, later-in-DOM) image paints over it. -->
          <USkeleton class="absolute inset-0" />
          <NuxtImg
            :src="album.cover"
            :alt="`Album ${album.title}`"
            sizes="400px"
            :placeholder="imagePlaceholder(album.cover)"
            placeholder-class="blur-lg"
            loading="lazy"
            class="relative aspect-[4/3] w-full bg-default object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
          <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-marine-950/85 via-marine-950/45 to-transparent p-4 pt-12">
            <p class="font-serif text-lg font-semibold text-white">{{ album.title }}</p>
            <p class="mt-0.5 text-xs text-marine-100">
              {{ album.count }} photos
              <template v-if="yearLabel(album)"> · {{ yearLabel(album) }}</template>
            </p>
          </div>
        </NuxtLink>
      </UPageGrid>
    </section>

    <section v-if="documentAlbums.length" class="mt-14" aria-labelledby="albums-docs-heading">
      <div class="mb-4">
        <h2 id="albums-docs-heading" class="font-serif text-xl font-semibold text-highlighted">
          Documents et affiches
        </h2>
        <p class="mt-1 text-sm text-muted">
          Affiches de concours, calendriers, règlements, blasons et bannières de l'ancien site.
        </p>
      </div>
      <UPageGrid class="sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        <NuxtLink
          v-for="album in documentAlbums"
          :key="album.key"
          :to="`/archives/galerie/${album.key}`"
          class="group flex items-center gap-3 rounded-xl border border-default bg-elevated p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
        >
          <NuxtImg
            :src="album.cover"
            :alt="`Album ${album.title}`"
            sizes="64px"
            loading="lazy"
            class="size-14 shrink-0 rounded-lg border border-default bg-muted object-cover"
          />
          <span class="min-w-0">
            <span class="block truncate text-sm font-medium text-highlighted transition-colors group-hover:text-primary">
              {{ album.title }}
            </span>
            <span class="block text-xs text-muted">{{ album.count }} éléments</span>
          </span>
        </NuxtLink>
      </UPageGrid>
    </section>
  </UContainer>
</template>
