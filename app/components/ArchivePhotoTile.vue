<script setup lang="ts">
// One photo tile in the archive gallery.
//
// Interaction model, and why it's built this way: the tile has TWO independent
// targets — "enlarge this photo" and "read the article it came from". Nesting an
// <a> inside a <button> is invalid HTML and leaves the link unreachable by
// keyboard, so they are siblings, layered with z-index over the image.
//
// The caption is revealed on hover AND focus-within, so keyboard users get it
// too. On touch there is no hover at all, which is why the lightbox repeats the
// full caption and the article link — that, not the hover state, is the
// accessible surface for this metadata.
import type { IndexedGalleryPhoto } from '~/utils/gallery'
import { formatPhotoDate, photoDomId } from '~/utils/gallery'

const props = defineProps<{
  photo: IndexedGalleryPhoto
  /** `square` crops to a uniform grid; `natural` keeps the real aspect ratio. */
  variant?: 'square' | 'natural'
  /** Pulses the tile — set when a URL fragment points at this photo. */
  flash?: boolean
}>()

// The id is what `#annee-YYYY` / `#photo-x` scroll to.
const domId = computed(() => photoDomId(props.photo.src))

const emit = defineEmits<{ open: [index: number] }>()

const dateLabel = computed(() => formatPhotoDate(props.photo))
// The importer sets `title` only when it could attribute the photo to exactly one
// article; most photos have none, and the tile must look right without it.
const hasCaption = computed(() =>
  Boolean(props.photo.title || props.photo.description || dateLabel.value),
)
const article = computed(() => props.photo.articles?.[0] ?? null)

const openLabel = computed(() => {
  const parts = ['Agrandir']
  if (props.photo.title) parts.push(`« ${props.photo.title} »`)
  if (dateLabel.value) parts.push(`(${dateLabel.value})`)
  return parts.join(' ')
})
</script>

<template>
  <div
    :id="domId"
    class="group relative overflow-hidden rounded-xl border border-default bg-default"
    :class="flash ? 'photo-flash' : undefined"
  >
    <!-- `overflow-hidden` is safe alongside the flash: it clips this element's
         DESCENDANTS (the zooming image, the caption gradient), not the element's
         own box-shadow, which is what the glow is drawn with. -->
    <!-- `variant: 'base'` pins the full-size file: this is the SAME file the
         lightbox opens, so loading the grid warms its cache (and the median photo
         is 680px anyway — the -800 rendition would be identical bytes under a
         different URL). Without it the provider would map the `w` attribute, which
         is only here to set the aspect ratio the CSS box reserves, which is what
         keeps the grid from shifting as photos decode. The blur placeholder is the
         photo's pre-generated -ph.webp sibling. -->
    <!-- Pulses until the (opaque) placeholder or photo paints over it — the img
         is `relative` and later in the DOM, so it stacks above the skeleton. -->
    <USkeleton class="absolute inset-0" />
    <NuxtImg
      :src="photo.src"
      :alt="photo.alt"
      :width="photo.w"
      :height="photo.h"
      :modifiers="{ variant: 'base' }"
      :placeholder="imagePlaceholder(photo.src)"
      placeholder-class="blur-lg"
      loading="lazy"
      class="relative w-full bg-default transition-transform duration-300 group-hover:scale-[1.03]"
      :class="variant === 'natural' ? 'h-full object-cover' : 'aspect-square object-cover'"
    />

    <!-- Enlarge target: covers the whole tile, sits under the caption layer. -->
    <button
      type="button"
      class="absolute inset-0 z-10 cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      :aria-label="openLabel"
      @click="emit('open', photo.index)"
    />

    <!-- Persistent hint that this photo is used by an article — visible without
         hovering, since hover doesn't exist on touch. -->
    <span
      v-if="article"
      class="pointer-events-none absolute right-2 top-2 z-20 inline-flex items-center rounded-full bg-marine-950/70 p-1.5 text-white backdrop-blur transition-opacity duration-200 group-hover:opacity-0"
      aria-hidden="true"
    >
      <UIcon name="i-lucide-newspaper" class="size-3.5" />
    </span>

    <!-- Caption layer: pointer-events-none so it never steals the enlarge click;
         the article link re-enables them for itself only. -->
    <div
      v-if="hasCaption || article"
      class="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-marine-950/90 via-marine-950/50 to-transparent p-3 pt-8 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
    >
      <p v-if="photo.title" class="line-clamp-2 text-xs font-medium leading-snug text-white">
        {{ photo.title }}
      </p>
      <p v-if="photo.description" class="mt-0.5 line-clamp-2 text-[0.7rem] leading-snug text-marine-100">
        {{ photo.description }}
      </p>
      <p v-if="dateLabel" class="mt-0.5 text-[0.7rem] text-marine-200">{{ dateLabel }}</p>

      <NuxtLink
        v-if="article"
        :to="article.path"
        class="pointer-events-auto relative z-30 mt-1.5 inline-flex items-center gap-1 rounded text-[0.7rem] font-medium text-white underline decoration-white/40 underline-offset-2 hover:decoration-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <UIcon name="i-lucide-newspaper" class="size-3" />
        Lire l'article
      </NuxtLink>
    </div>
  </div>
</template>
