// Shrinks images on their way into Nuxt Studio's media store.
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
      init?.method?.toUpperCase() === 'PUT'
      && typeof init.body === 'string'
      && requestUrl(input).includes(MEDIA_ENDPOINT)
    ) {
      init = { ...init, body: await shrinkBody(init.body) }
    }
    return original(input, init)
  }
})

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

async function shrinkBody(body: string): Promise<string> {
  try {
    const parsed = JSON.parse(body)
    if (typeof parsed?.raw !== 'string' || !parsed.raw.startsWith('data:image/')) return body

    const { downscaleImage } = await import('~/utils/downscale-image')
    const raw = await downscaleImage(parsed.raw)
    if (import.meta.dev) {
      const kb = (s: string) => Math.round(s.split(';base64,')[1]!.length * 3 / 4 / 1024)
      console.info(`[studio-media-resize] ${kb(parsed.raw)} KB → ${kb(raw)} KB`)
    }
    return raw === parsed.raw ? body : JSON.stringify({ ...parsed, raw })
  }
  catch (error) {
    // Never lose an editor's upload over this: HEIC, for one, has no decoder in
    // Chrome or Firefox and throws here. Falling back to the original bytes
    // keeps the save working; the server-side allowedTypes list is what stops
    // untransformable formats from reaching R2.
    console.warn('[studio-media-resize] uploading original, resize failed:', error)
    return body
  }
}
