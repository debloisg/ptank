// Browser-side fallback for the two derived renditions every uploaded image
// needs (`-800.webp`, `-ph.webp`).
//
// The normal path is server-side: server/plugins/studio-media-variants.ts turns
// the upload into <=1600 base + -800 + -ph with ONE Cloudflare Image
// Transformation each, right after the PUT lands. That path dies when the
// account's free transformation quota for the month is spent — Cloudflare then
// answers every transform with `429 … cf-resized: err=9422`, and the plugin can
// only store oversized copies under the rendition keys. The site keeps working
// (the keys exist) but nothing is actually resized, which is what a visitor
// pays for.
//
// So: probe the transformation endpoint once per editor session and, when it is
// unavailable, build the renditions from the same bytes the browser is already
// holding. Canvas output is a notch below Cloudflare's encoder — hence a
// fallback, not the default.
//
// Loaded lazily from app/plugins/studio-media-resize.client.ts; never on a
// public page.
import { resizeImage } from './downscale-image'

// [suffix, max width, quality] — must match RENDITIONS in
// server/plugins/studio-media-variants.ts, which is what the r2-variants
// provider and imagePlaceholder() expect to find in the bucket. '' is the base
// object: WebP bytes under the ORIGINAL extension, exactly as the server
// rendition stores them (the key comes from the filename Studio already wrote
// into the content; browsers go by Content-Type).
const RENDITIONS: [string, number, number][] = [
  ['', 1600, 0.8],
  ['-800.webp', 800, 0.75],
  ['-ph.webp', 24, 0.4],
]

// Any stored image works; this one is the site's own hero and the og:image
// source, so it is not going anywhere. Fixed URL on purpose: a probe that
// SUCCEEDS costs exactly one unique transformation per month, forever.
const PROBE_SRC = '/images/hero-terrain.jpg'

let probe: Promise<boolean> | undefined

/**
 * True when Cloudflare Image Transformations answer on this origin — false when
 * the quota is spent (429/err=9422), the zone has them disabled, or there is no
 * Cloudflare in front at all (which is the case in `nuxt dev`, so the fallback
 * is what runs locally and stays testable).
 *
 * Probed with an <img> rather than fetch(): the Studio CSP allows
 * `connect-src 'self' …` but a failed transform answers `text/plain`, and an
 * image element reports that as an error without any body parsing.
 */
export function transformsAvailable(): Promise<boolean> {
  probe ??= new Promise<boolean>((resolve) => {
    const r2Base = useRuntimeConfig().public.imageR2Base
    const img = new Image()
    img.onload = () => resolve(img.naturalWidth > 0)
    img.onerror = () => resolve(false)
    // Same-origin path: /cdn-cgi/** is handled by the edge, ahead of the Worker.
    img.src = `/cdn-cgi/image/width=16,quality=1,format=webp/${r2Base}${PROBE_SRC}`
  })
  return probe
}

/**
 * Every rendition for `dataUrl`: the base (uploaded in place of the original
 * bytes) and the suffixed siblings (uploaded as their own keys).
 *
 * Returns undefined if ANY of them fails to encode — the caller then uploads
 * normally and lets the server try. All-or-nothing on purpose: half the
 * renditions from canvas and half from Cloudflare would mix two encoders'
 * output for one image, and a partial set is worse than none (the server's own
 * fallback at least fills every key).
 */
export async function buildRenditions(
  dataUrl: string,
): Promise<{ base: string, variants: [string, string][] } | undefined> {
  const encoded: [string, string][] = []
  for (const [suffix, width, quality] of RENDITIONS) {
    const out = await resizeImage(dataUrl, width, quality)
    if (!out) return undefined
    encoded.push([suffix, out])
  }
  const [, base] = encoded.find(([suffix]) => suffix === '')!
  return { base, variants: encoded.filter(([suffix]) => suffix !== '') }
}
