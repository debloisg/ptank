<script setup lang="ts">
// Thin wrapper over Nuxt UI's own ProseImg — the component that renders every
// markdown image AND the article hero in pages/[...slug].vue.
//
// DO NOT reimplement the upstream component here: click-to-zoom lives inside it
// (a shadow copy without it silently killed the zoom once already). This wrapper
// only ADDS what can't be expressed in markdown without touching the content —
// content md is never rewritten for presentation concerns, Studio drafts are
// diffed against it and any git-side rewrite surfaces as an editor conflict:
//
//   - the blur placeholder, computed from the src (`foo.webp` -> `foo-ph.webp`,
//     a pre-generated ~300 B file in R2 — no edge transforms, see nuxt.config.ts);
//   - `sizes`, so the provider can serve the -800 rendition when the slot allows;
//   - lazy loading by default — body images sit below the fold.
//
// Anything the caller passes explicitly ($attrs, e.g. the hero's
// loading="eager") wins over these defaults. Eager images get NO placeholder:
// NuxtImg defers the real file to after hydration when one is set, which is
// exactly wrong for an LCP image.
import UProseImg from '@nuxt/ui/components/prose/Img.vue'

const props = withDefaults(defineProps<{
  src?: string
  alt?: string
  width?: string | number
  height?: string | number
}>(), { src: '', alt: '', width: undefined, height: undefined })

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()
const eager = computed(() => attrs.loading === 'eager')
</script>

<template>
  <UProseImg
    :src="props.src"
    :alt="props.alt"
    :width="props.width"
    :height="props.height"
    sizes="100vw sm:680px"
    loading="lazy"
    :placeholder="eager ? undefined : imagePlaceholder(props.src)"
    placeholder-class="blur-lg"
    v-bind="$attrs"
  />
</template>
