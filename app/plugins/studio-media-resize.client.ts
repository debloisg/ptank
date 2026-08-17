// Shrinks images on their way into Nuxt Studio's media store, and — when
// Cloudflare's transformation quota is spent — builds their `-800`/`-ph`
// renditions here instead of on the server.
//
// Studio has no upload-processing hook (nuxt-content/nuxt-studio#348), so the
// interception happens at the only stable surface it exposes: the PUT to
// /__nuxt_studio/medias/**, whose body is `{ ...media, raw: "data:<mime>;base64,…" }`.
// Everything heavier lives in a lazily imported chunk, so public pages ship only
// the few hundred bytes of guard below.
export default defineNuxtPlugin(() => {
  const MEDIA_ENDPOINT = '/__nuxt_studio/medias/'
  const original = globalThis.fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (
      init?.method?.toUpperCase() !== 'PUT'
      || typeof init.body !== 'string'
      || !requestUrl(input).includes(MEDIA_ENDPOINT)
    ) {
      return original(input, init)
    }

    const { body, renditions } = await prepareUpload(init.body)
    // The header tells server/plugins/studio-media-variants.ts to stand down:
    // the renditions are coming from here, and its quota-exhausted fallback
    // would otherwise overwrite them with oversized copies of the original.
    const headers = renditions.length
      ? { ...headersToObject(init.headers), 'x-ptank-renditions': 'client' }
      : init.headers

    const response = await original(input, { ...init, body, headers })
    if (!response.ok || !renditions.length) return response

    // After the base object, never before: a rendition in the bucket whose base
    // upload then failed is a file nothing references and nothing cleans up.
    await Promise.all(renditions.map(async ([suffix, raw]) => {
      const url = requestUrl(input).replace(/\.(jpe?g|png|webp)(?=$|\?)/i, suffix)
      const res = await original(url, {
        ...init,
        headers: { ...headersToObject(init.headers), 'x-ptank-renditions': 'client' },
        body: JSON.stringify({ raw }),
      })
      if (!res.ok) console.error(`[studio-media-resize] ${suffix} upload failed: ${res.status}`)
    }))

    return response
  }
})

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function headersToObject(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {}
  return Object.fromEntries(new Headers(headers).entries())
}

async function prepareUpload(body: string): Promise<{ body: string, renditions: [string, string][] }> {
  try {
    const parsed = JSON.parse(body)
    if (typeof parsed?.raw !== 'string' || !parsed.raw.startsWith('data:image/')) {
      return { body, renditions: [] }
    }

    // Asked before any encoding: when the transforms answer, the browser's only
    // job is to keep the PUT small and hand the server a sharp source; when they
    // do not, the browser produces the final files itself and must work from the
    // ORIGINAL pixels rather than from a transport re-encode of them.
    const { transformsAvailable, buildRenditions } = await import('~/utils/studio-renditions')
    if (!await transformsAvailable()) {
      const built = await buildRenditions(parsed.raw)
      if (built) {
        return {
          body: JSON.stringify({ ...parsed, raw: built.base }),
          renditions: built.variants,
        }
      }
      console.warn('[studio-media-resize] no transforms and no canvas WebP — uploading as-is')
    }

    const { downscaleImage } = await import('~/utils/downscale-image')
    const raw = await downscaleImage(parsed.raw)
    if (import.meta.dev) {
      const kb = (s: string) => Math.round(s.split(';base64,')[1]!.length * 3 / 4 / 1024)
      console.warn(`[studio-media-resize] ${kb(parsed.raw)} KB → ${kb(raw)} KB`)
    }

    return { body: raw === parsed.raw ? body : JSON.stringify({ ...parsed, raw }), renditions: [] }
  }
  catch (error) {
    // Never lose an editor's upload over this: HEIC, for one, has no decoder in
    // Chrome or Firefox and throws here. Falling back to the original bytes
    // keeps the save working; the server-side allowedTypes list is what stops
    // untransformable formats from reaching R2.
    console.warn('[studio-media-resize] uploading original, resize failed:', error)
    return { body, renditions: [] }
  }
}
