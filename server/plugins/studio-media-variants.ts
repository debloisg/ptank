// Generates the site's three pre-built renditions for every image uploaded
// through Nuxt Studio's media tab, matching what scripts/generate-image-variants.mjs
// produced for the existing corpus:
//
//   <name>.<ext>      overwritten with a <=1600px WebP encode of the upload
//                     (the KEY keeps the original extension — Studio's client
//                     derives it from the filename and inserts it into content,
//                     so renaming would desync its draft state; browsers render
//                     by Content-Type, which is set correctly to image/webp)
//   <stem>-800.webp   srcset rendition the r2-variants provider maps to
//   <stem>-ph.webp    ~24px blur placeholder
//
// HOW: nuxt-studio's own PUT handler stores the original first (auth included —
// this hook only ever runs after that handler responded 2xx). The heavy work
// then runs post-response via waitUntil, using Cloudflare Image Transformations
// through `fetch(url, { cf: { image } })` — the transform happens ONCE per
// upload (3 uniques against the 5,000/month free tier) and lands back in R2 as
// plain files; visitors never trigger a transform.
//
// The base fetch runs LAST: each variant fetch pulls the ORIGINAL object from
// the bucket, so the base overwrite must not happen while -800/-ph still need it.
//
// In dev the wrangler proxy ignores `cf.image`, so the variants are byte-copies
// of the original — harmless, and the names the provider expects still exist.
//
// Failure mode: the original stays live (correct pixels, heavy file) and the
// error is logged; re-uploading the image retries everything.
import { blob } from '@nuxthub/blob'

const MEDIA_PUT = '/__nuxt_studio/medias/'
const IMAGE_KEY = /\.(jpe?g|png|webp)$/i

// [suffix, width, quality]; '' = the base overwrite, which must stay last.
const RENDITIONS: [string, number, number][] = [
  ['-800.webp', 800, 75],
  ['-ph.webp', 24, 40],
  ['', 1600, 80],
]

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('afterResponse', async (event) => {
    if (event.method !== 'PUT' || !event.path.startsWith(MEDIA_PUT)) return
    if (getResponseStatus(event) >= 300) return

    // Same key derivation as nuxt-studio's medias route ("public-assets" is its
    // virtual collection segment; `prefix` is the studio.media prefix, "images").
    const { prefix } = useRuntimeConfig(event).public.studio.media
    const blobPath = event.path
      .slice(MEDIA_PUT.length)
      .replace(/^public-assets\//, '')
    if (!IMAGE_KEY.test(blobPath)) return

    const pathname = prefix ? `${prefix}/${blobPath}` : blobPath
    const r2Base = useRuntimeConfig(event).public.imageR2Base
    if (!r2Base) return

    const job = generateRenditions(`${r2Base}/${pathname}`, pathname)
    if (event.waitUntil) event.waitUntil(job)
    else await job
  })
})

async function generateRenditions(sourceUrl: string, pathname: string) {
  const stem = pathname.replace(IMAGE_KEY, '')

  // Fetched once up front as the fallback: when a transform fails — the free
  // transformation quota being exhausted returns 429 "ERROR 9422", and that is
  // not hypothetical, it's the incident this whole pipeline exists for — the
  // variant KEYS must still be created. The provider maps width requests to
  // -800.webp unconditionally (its no-metadata contract), so a missing variant
  // is a 404 on every card that renders the upload. Oversized copies are the
  // degraded-but-correct fallback; re-uploading the image after the quota
  // resets regenerates them properly.
  const original = await fetch(sourceUrl)
  if (!original.ok) {
    console.error(`[studio-media-variants] ${pathname}: source fetch ${original.status}`)
    return
  }
  const originalBytes = new Uint8Array(await original.arrayBuffer())
  const originalType = original.headers.get('content-type') ?? 'application/octet-stream'

  for (const [suffix, width, quality] of RENDITIONS) {
    const key = suffix ? `${stem}${suffix}` : pathname
    try {
      const res = await fetch(sourceUrl, {
        cf: { image: { width, quality, format: 'webp', fit: 'scale-down' } },
      } as RequestInit)
      // A failed transform can still be a 200/429 with a text/plain error body
      // — never store non-image bytes under an image key.
      const type = res.headers.get('content-type') ?? ''
      if (!res.ok || !type.startsWith('image/')) throw new Error(`transform ${res.status} ${type}`)
      await blob.put(key, new Uint8Array(await res.arrayBuffer()), { contentType: type })
    }
    catch (error) {
      console.error(`[studio-media-variants] ${pathname}${suffix} transform failed, storing copy:`, error)
      // Base key already holds the original — only the variant names need filling.
      if (suffix) {
        await blob.put(key, originalBytes, { contentType: originalType })
      }
    }
  }
}
