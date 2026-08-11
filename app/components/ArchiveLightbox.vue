<script setup lang="ts">
// Fullscreen photo viewer for the archive gallery albums.
//
// Built on <UModal fullscreen> rather than a bespoke overlay so it inherits the
// design system's focus trap, scroll lock and Escape handling — all easy to get
// subtly wrong by hand, and all things axe-core checks for.
//
// This component is the viewer only; the thumbnails live in <ArchivePhotoGrid>.
// It is driven from the parent via the exposed `show(index)`, and the index is
// into the album's flat chronological list so prev/next walk the whole album
// regardless of which disposition the thumbnails are rendered in.
import type { GalleryPhoto } from '~/utils/gallery'
import { formatPhotoDate } from '~/utils/gallery'

const props = defineProps<{
  photos: GalleryPhoto[]
  albumTitle: string
}>()

// `index` is the single source of truth: null = closed. One value drives both the
// open state and which photo shows, so the two can never disagree.
const index = ref<number | null>(null)

const open = computed({
  get: () => index.value !== null,
  set: (value: boolean) => {
    if (!value) index.value = null
  },
})

const current = computed(() => (index.value === null ? null : props.photos[index.value] ?? null))
const dateLabel = computed(() => (current.value ? formatPhotoDate(current.value) : null))
const articles = computed(() => current.value?.articles ?? [])

function show(i: number) {
  index.value = i
}

// Wrap around at both ends: in a photo album, going back from the first picture
// to the last is more useful than a dead button.
function step(delta: number) {
  if (index.value === null || !props.photos.length) return
  const count = props.photos.length
  index.value = (index.value + delta + count) % count
}

function onKeydown(event: KeyboardEvent) {
  if (index.value === null) return
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    step(1)
  }
  else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    step(-1)
  }
}

// Bound on window rather than the modal element so the arrow keys work wherever
// focus sits inside the dialog (close button, image, backdrop).
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

// Preload the immediate neighbours so stepping through an album doesn't flash an
// empty frame. Only the two adjacent photos — preloading a 296-photo album would
// defeat the point of lazy-loading the grid.
const neighbours = computed(() => {
  if (index.value === null || props.photos.length < 2) return []
  const count = props.photos.length
  return [(index.value + 1) % count, (index.value - 1 + count) % count]
    .map(i => props.photos[i])
    .filter((p): p is GalleryPhoto => Boolean(p))
})

defineExpose({ show })
</script>

<template>
  <UModal
    v-model:open="open"
    fullscreen
    :close="false"
    :title="albumTitle"
    :description="current?.title ?? current?.alt"
    :ui="{ content: 'bg-marine-950/95 ring-0 divide-y-0' }"
  >
    <template #content="{ close }">
      <div class="relative flex h-full w-full flex-col">
        <div class="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <p class="min-w-0 truncate text-sm text-marine-100">
            <span class="font-medium">{{ albumTitle }}</span>
            <span v-if="index !== null" class="ml-2 tabular-nums text-marine-300">
              {{ index + 1 }} / {{ photos.length }}
            </span>
          </p>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            aria-label="Fermer la visionneuse"
            class="shrink-0 text-marine-100 hover:bg-white/10 hover:text-white"
            @click="close()"
          />
        </div>

        <div class="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16">
          <NuxtImg
            v-if="current"
            :key="current.src"
            :src="current.src"
            :alt="current.alt"
            :width="current.w"
            :height="current.h"
            format="auto"
            sizes="100vw lg:1400px"
            loading="eager"
            fetchpriority="high"
            class="max-h-full max-w-full object-contain"
          />

          <template v-if="photos.length > 1">
            <UButton
              color="neutral"
              variant="solid"
              size="lg"
              icon="i-lucide-chevron-left"
              aria-label="Photo précédente"
              class="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-marine-950/60 text-marine-50 backdrop-blur hover:bg-marine-950/80 sm:left-4"
              @click="step(-1)"
            />
            <UButton
              color="neutral"
              variant="solid"
              size="lg"
              icon="i-lucide-chevron-right"
              aria-label="Photo suivante"
              class="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-marine-950/60 text-marine-50 backdrop-blur hover:bg-marine-950/80 sm:right-4"
              @click="step(1)"
            />
          </template>
        </div>

        <!-- Caption bar. This is where the metadata is genuinely reachable: the
             thumbnail hover state doesn't exist on touch devices, so the title,
             date and article links have to be available here too. -->
        <div
          v-if="current && (current.title || current.description || dateLabel || articles.length)"
          class="shrink-0 px-4 py-4 text-center sm:px-16"
        >
          <p v-if="current.title" class="text-sm font-medium text-white">{{ current.title }}</p>
          <p v-if="current.description" class="mx-auto mt-1 max-w-2xl text-xs text-marine-100">
            {{ current.description }}
          </p>
          <p v-if="dateLabel" class="mt-1 text-xs text-marine-300">{{ dateLabel }}</p>
          <div v-if="articles.length" class="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <NuxtLink
              v-for="article in articles"
              :key="article.path"
              :to="article.path"
              class="inline-flex items-center gap-1.5 text-xs font-medium text-white underline decoration-white/40 underline-offset-2 hover:decoration-white"
            >
              <UIcon name="i-lucide-newspaper" class="size-3.5" />
              {{ article.title }}
            </NuxtLink>
          </div>
        </div>

        <!-- Off-screen neighbour preloads. aria-hidden + no layout footprint. -->
        <div aria-hidden="true" class="pointer-events-none absolute size-px overflow-hidden opacity-0">
          <NuxtImg
            v-for="photo in neighbours"
            :key="photo.src"
            :src="photo.src"
            alt=""
            :width="photo.w"
            :height="photo.h"
            format="auto"
            sizes="100vw lg:1400px"
            loading="eager"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
