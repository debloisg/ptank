<script setup lang="ts">
// One gallery album: /archives/galerie/championnats.
//
// Photos are laid out as a justified mosaic: rows fill the width while each photo
// keeps its true aspect ratio. This was chosen over a uniform square grid (which
// crops every subject) and over a per-year timeline (redundant now that /archives
// is itself a chronological feed that deep-links in here).
//
// Landing here with a `#annee-YYYY` or `#photo-x` fragment scrolls to those photos
// and pulses them — see revealFromHash below.
import type { GalleryPhoto, IndexedGalleryPhoto } from '~/utils/gallery'
import { formatAlbumSpan, photoDomId, resolvePhotoHash } from '~/utils/gallery'

const route = useRoute()

const { data } = await useAsyncData(`galerie-${route.params.album}`, async () => {
  const [album, all] = await Promise.all([
    queryCollection('galerie').where('key', '=', String(route.params.album)).first(),
    // Album metadata only (no `photos`) for the prev/next stepper, so paging
    // between albums doesn't pull 1355 photo records into this page's payload.
    queryCollection('galerie').select('key', 'title', 'kind', 'count').all(),
  ])
  return { album, all }
})

const album = computed(() => data.value?.album ?? null)

if (!album.value) {
  throw createError({ statusCode: 404, statusMessage: 'Album introuvable', fatal: true })
}

// The importer already sorts photos chronologically. Attaching the flat index here
// means every disposition can hand the lightbox a position that walks the whole
// album in date order, even when the thumbnails are visually regrouped by year.
const photos = computed<IndexedGalleryPhoto[]>(() =>
  ((album.value?.photos ?? []) as GalleryPhoto[]).map((photo, index) => ({ ...photo, index })),
)

const withArticles = computed(() => photos.value.filter(p => p.articles?.length).length)

// ── Arriving from a link that points at specific photos ──────────────────────
// /archives links here as `#annee-2013`; the lightbox can also deep-link a single
// photo as `#photo-x`. Either way: scroll to the first match and pulse them all,
// so it's obvious which of up to 296 pictures the link meant.
const FLASH_MS = 3000
const flashed = ref<Set<string>>(new Set())
let flashTimer: ReturnType<typeof setTimeout> | undefined

async function revealFromHash() {
  const targets = resolvePhotoHash(route.hash, photos.value)
  clearTimeout(flashTimer)
  if (!targets.length) {
    flashed.value = new Set()
    return
  }
  flashed.value = new Set(targets)

  // Wait for the tiles to exist before measuring, and prefer instant scrolling for
  // anyone who asked for reduced motion.
  await nextTick()
  const first = document.getElementById(photoDomId(targets[0]!))
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  first?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })

  // Clear the class afterwards so re-navigating to the same fragment can replay
  // the animation, and so the glow doesn't linger while browsing.
  flashTimer = setTimeout(() => {
    flashed.value = new Set()
  }, FLASH_MS)
}

onMounted(revealFromHash)
// Same-page navigation (clicking another `#annee-` link) changes only the hash, so
// the component isn't remounted — watch it explicitly.
watch(() => route.hash, revealFromHash)
onBeforeUnmount(() => clearTimeout(flashTimer))

const lightbox = useTemplateRef<{ show: (index: number) => void }>('lightbox')
function openAt(index: number) {
  lightbox.value?.show(index)
}

const yearLabel = computed(() => (album.value ? formatAlbumSpan(album.value) : null))

// Ordered the same way /archives/galerie renders them, so "album suivant" moves
// where the eye expects rather than in D1 insertion order.
const siblings = computed(() =>
  (data.value?.all ?? [])
    .filter(a => a.kind === album.value?.kind)
    .sort((a, b) => b.count - a.count),
)
const neighbours = computed(() => {
  const list = siblings.value
  const i = list.findIndex(a => a.key === album.value?.key)
  return {
    previous: i > 0 ? list[i - 1] : null,
    next: i >= 0 && i < list.length - 1 ? list[i + 1] : null,
  }
})

// Per-album social image, cropped to the OG canvas by Cloudflare Image
// Transformations — same approach as pages/[...slug].vue. f=jpeg because social
// scrapers don't negotiate AVIF/WebP.
const siteConfig = useSiteConfig()
const r2Base = useRuntimeConfig().public.imageR2Base
const ogImage = computed(() =>
  album.value?.cover
    ? `${siteConfig.url}/cdn-cgi/image/w=1200,h=630,fit=cover,f=jpeg,q=80/${r2Base}${album.value.cover}`
    : undefined,
)

useSeoMeta({
  title: () => `${album.value?.title ?? 'Album'} · Archives · Pétanque Fouesnantaise`,
  description: () =>
    `${album.value?.count ?? 0} photos d'archive du club — album « ${album.value?.title ?? ''} ».`,
  ogImage: () => ogImage.value,
  twitterImage: () => ogImage.value,
})
</script>

<template>
  <UContainer class="py-12 sm:py-16">
    <UButton
      to="/archives/galerie"
      variant="link"
      color="primary"
      icon="i-lucide-arrow-left"
      label="Tous les albums"
      class="mb-6 -ml-2"
    />

    <UPageHeader :title="album?.title">
      <template #description>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <span class="inline-flex items-center gap-1.5">
            <UIcon name="i-lucide-image" class="size-4" />
            {{ album?.count }} {{ album?.kind === 'documents' ? 'éléments' : 'photos' }}
          </span>
          <span v-if="yearLabel" class="inline-flex items-center gap-1.5">
            <UIcon name="i-lucide-calendar" class="size-4" />{{ yearLabel }}
          </span>
          <span v-if="withArticles" class="inline-flex items-center gap-1.5">
            <UIcon name="i-lucide-newspaper" class="size-4" />
            {{ withArticles }} liée{{ withArticles > 1 ? 's' : '' }} à un article
          </span>
        </div>
      </template>
    </UPageHeader>

    <p class="mt-6 text-sm text-dimmed">
      Cliquez sur une image pour l'agrandir, puis naviguez avec les flèches.
    </p>

    <!-- Mosaic only: it preserves each photo's real aspect ratio while filling the
         width, which suits a photo album better than cropping everything square. -->
    <ArchivePhotoGrid
      :photos="photos"
      disposition="mosaic"
      :flashed="flashed"
      class="mt-4"
      @open="openAt"
    />

    <ArchiveLightbox
      v-if="album"
      ref="lightbox"
      :photos="photos"
      :album-title="album.title"
    />

    <nav class="mt-12 flex items-center justify-between gap-4 border-t border-default pt-6" aria-label="Navigation entre les albums">
      <UButton
        v-if="neighbours.previous"
        :to="`/archives/galerie/${neighbours.previous.key}`"
        variant="ghost"
        color="neutral"
        icon="i-lucide-chevron-left"
        :label="neighbours.previous.title"
        class="max-w-[45%] truncate"
      />
      <span v-else />
      <UButton
        v-if="neighbours.next"
        :to="`/archives/galerie/${neighbours.next.key}`"
        variant="ghost"
        color="neutral"
        trailing-icon="i-lucide-chevron-right"
        :label="neighbours.next.title"
        class="max-w-[45%] truncate"
      />
      <span v-else />
    </nav>
  </UContainer>
</template>
