// Every site image has a pre-generated ~24px blur placeholder sibling in R2
// (`foo.webp` -> `foo-ph.webp`, ~300 B — see scripts/generate-image-variants.mjs).
// NuxtImg's `placeholder` prop takes this URL as-is (no provider resolution),
// so it must be absolute. GIFs have no variants and get none.
const VARIANT_SRC = /\.(webp|jpe?g|png)$/i

// Content stores root-relative `/images/…`. An already-absolute src (a Studio
// draft written before studio.media.publicUrl was pinned to '/') must be left
// alone rather than prefixed a second time — same guard as the r2-variants
// provider, which has to keep its own copy (it is a standalone runtime file
// with no auto-imports).
const ABSOLUTE = /^(?:[a-z][a-z\d+\-.]*:)?\/\//i

/**
 * Absolute R2 URL for a content image path — for <meta> tags, which cannot take
 * a relative one. Absolute srcs pass through unchanged.
 *
 * Takes the base as an argument rather than reading runtimeConfig itself:
 * og:image is resolved by unhead OUTSIDE the component's setup context, so a
 * `useRuntimeConfig()` in here throws NUXT_E1001 (500) on every page that has an
 * image. Callers read the base once in setup and pass it in.
 */
export function absoluteImageUrl(src: string | undefined, base: string): string | undefined {
  if (!src) return undefined
  return ABSOLUTE.test(src) ? src : `${base}${src}`
}

/**
 * Is this page being rendered inside the Nuxt Studio editor?
 *
 * The panel writes `studio-active` before it boots and never clears it while
 * the page lives, so the answer cannot change after load — hence the cache,
 * which also keeps this to a single localStorage read per page instead of one
 * per component that asks. Always false on the server: the flag is a browser
 * fact, and the editor re-renders on the client anyway.
 */
let studioSession: boolean | undefined
export function isStudioSession(): boolean {
  if (import.meta.server) return false
  if (studioSession === undefined) {
    try {
      studioSession = JSON.parse(localStorage.getItem('studio-active') || '{}')?.active === true
    }
    catch {
      // A corrupt flag is not a reason to change how the site renders.
      studioSession = false
    }
  }
  return studioSession
}

// The composable is safe here: this one is only ever called from a component's
// setup/render (ProseImg's template).
export function imagePlaceholder(src?: string): string | undefined {
  if (!src || !VARIANT_SRC.test(src)) return undefined
  const base = useRuntimeConfig().public.imageR2Base
  return absoluteImageUrl(src.replace(VARIANT_SRC, '-ph.webp'), base)
}
