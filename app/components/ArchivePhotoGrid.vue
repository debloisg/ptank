<script setup lang="ts">
// Renders a set of gallery photos in one of two dispositions.
//
// `grid`   — uniform squares. Densest and easiest to scan; crops every photo.
// `mosaic` — justified rows that preserve each photo's real aspect ratio.
//
// The mosaic uses the classic flex justification trick rather than CSS
// `columns`: multi-column layout fills top-to-bottom down column 1 before
// starting column 2, which scrambles reading order. These photos are sorted
// chronologically, so order has to read left-to-right — hence flex rows, where
// `flex-grow`/`flex-basis` proportional to the aspect ratio let each row fill the
// width exactly while keeping the sequence intact.
import type { IndexedGalleryPhoto } from '~/utils/gallery'

const props = defineProps<{
  photos: IndexedGalleryPhoto[]
  disposition?: 'grid' | 'mosaic'
  /** Narrower `sizes` when the grid sits in a narrower column. */
  sizes?: string
  /** `src`s to pulse — the photos a URL fragment pointed at. */
  flashed?: Set<string>
}>()

const emit = defineEmits<{ open: [index: number] }>()

// Guard against a 0 height in the catalogue: a NaN/Infinity flex-basis would
// collapse the whole row.
function ratio(photo: IndexedGalleryPhoto) {
  return photo.h > 0 ? photo.w / photo.h : 1
}
</script>

<template>
  <ul v-if="props.disposition === 'mosaic'" class="flex flex-wrap gap-2 sm:gap-3">
    <li
      v-for="photo in photos"
      :key="photo.src"
      class="h-32 sm:h-40 lg:h-48"
      :style="{ flexGrow: ratio(photo), flexBasis: `${ratio(photo) * 10}rem` }"
    >
      <ArchivePhotoTile
        :photo="photo"
        variant="natural"
        :sizes="sizes ?? '50vw sm:33vw lg:25vw'"
        :flash="flashed?.has(photo.src)"
        class="h-full"
        @open="emit('open', $event)"
      />
    </li>
  </ul>

  <ul v-else class="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
    <li v-for="photo in photos" :key="photo.src">
      <ArchivePhotoTile
        :photo="photo"
        variant="square"
        :sizes="sizes ?? '50vw sm:33vw lg:25vw'"
        :flash="flashed?.has(photo.src)"
        @open="emit('open', $event)"
      />
    </li>
  </ul>
</template>
