// Custom @nuxt/image provider for the pre-generated R2 variants.
//
// The site serves images raw from R2 — no edge transforms (billing; see the
// `image` block in nuxt.config.ts). Responsiveness comes from files generated
// AHEAD of time instead: every base image has a `-800.webp` sibling (and a
// `-ph.webp` placeholder, requested explicitly by components, not through this
// provider). Existing corpus: scripts/generate-image-variants.mjs; future
// Studio uploads: server/plugins/studio-media-variants.ts at upload time.
//
// The mapping is a pure string rewrite and must stay that way: `foo.ext` +
// width<=800 -> `foo-800.webp`. It can never 404 because the generators emit
// the -800 name for EVERY image, byte-copying when the base is already small —
// dumb duplication in the bucket buys a provider with no metadata, no probing
// and no per-section code paths.
//
// GIFs pass through verbatim at every width: animated dividers/blasons, no
// variants generated for them (a WebP re-encode would cost animation on the
// older Safaris this club's audience still uses).
import { defineProvider } from '@nuxt/image/runtime'
import type { ProviderGetImage } from '@nuxt/image'

// Registers the extra `:modifiers` keys used on NuxtImg site-wide:
// `variant` for this provider, `onerror` for the opt-in cloudflare provider
// (mandatory there — it's what degrades an exhausted-quota transform to a
// 307 onto the original file instead of a text error).
declare module '@nuxt/image' {
  interface ImageModifiers {
    variant: 'base'
    onerror: 'redirect'
  }
}

const VARIANT_SRC = /\.(webp|jpe?g|png)$/i
// @nuxt/image hands absolute URLs to the provider untouched (it only skips the
// provider for `data:`), so prefixing blindly would double the origin on any
// src that already carries one — which Studio's media picker used to write.
// Content should hold `/images/…`, but a stray absolute URL must still render.
const ABSOLUTE = /^(?:[a-z][a-z\d+\-.]*:)?\/\//i

const getImage: ProviderGetImage = (src, { modifiers, baseURL = '' }) => {
  // `:modifiers="{ variant: 'base' }"` pins the base file regardless of any
  // width/height attributes set for aspect-ratio purposes. Used where two
  // surfaces deliberately share one URL so the first warms the cache for the
  // second (gallery tile -> lightbox).
  const width = Number(modifiers.width) || 0
  const url = modifiers.variant !== 'base' && width > 0 && width <= 800 && VARIANT_SRC.test(src)
    ? src.replace(VARIANT_SRC, '-800.webp')
    : src
  return { url: ABSOLUTE.test(url) ? url : `${baseURL}${url}` }
}

export default defineProvider({ getImage })
