// Downscale + re-encode an image data URL in the browser, before it is uploaded.
//
// Nuxt Studio stores whatever the editor picked, byte for byte: its client reads
// the File with FileReader.readAsDataURL and PUTs that string to
// /__nuxt_studio/medias/**, which writes it straight to R2 (upstream request:
// nuxt-content/nuxt-studio#348, open). A 12 MP phone photo therefore lands as a
// multi-MB master. Measured on a 3024x4032 phone shot: 1.09 MB → 0.37 MB (-66%),
// and more on a real (less compressible) camera JPEG.
//
// Only loaded from the Studio upload path, as a separate chunk — see
// app/plugins/studio-media-resize.client.ts.

// Longest edge kept. This is a TRANSPORT cap, not the final output: what
// visitors download is re-encoded server-side after the upload lands
// (server/plugins/studio-media-variants.ts generates the <=1600 base, -800 and
// -ph renditions via a one-time Cloudflare transform). So the only jobs left
// here are keeping the base64 PUT body under Studio's 10 MB media limit and
// handing the server transform a still-sharp source — hence a generous edge
// and near-lossless quality.
const MAX_EDGE = 2400
const QUALITY = 0.9
// Below this, re-encoding costs more bytes than it saves: running the curated
// 2000px masters through canvas at q82 made them 4% BIGGER.
const SKIP_BELOW_BYTES = 600 * 1024

/**
 * Returns a downscaled JPEG data URL, or the input untouched when there is
 * nothing to gain. JPEG rather than WebP: Studio derives both the R2 key and
 * the path it inserts into content from the ORIGINAL filename, so emitting
 * WebP bytes would lie about the extension — and Safari cannot encode WebP
 * from a canvas anyway. The server-side re-encode produces the WebP the
 * visitors actually get.
 */
export async function downscaleImage(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith('data:image/')) return dataUrl

  const blob = dataUrlToBlob(dataUrl)
  // from-image: iPhone photos carry their rotation in EXIF, and canvas drops all
  // metadata, so the orientation has to be baked into the pixels here or the
  // photo lands sideways on the site.
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  const longest = Math.max(bitmap.width, bitmap.height)

  if (longest <= MAX_EDGE && blob.size <= SKIP_BELOW_BYTES) {
    bitmap.close()
    return dataUrl
  }

  const scale = Math.min(1, MAX_EDGE / longest)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return dataUrl
  }
  // The default single-step bilinear downsample is visibly mushy past ~3x.
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const out = canvas.toDataURL('image/jpeg', QUALITY)
  // toDataURL falls back to PNG for any format it cannot encode, silently. JPEG
  // is mandatory in every browser so this should never fire, but a PNG of a
  // 2200px photo is several MB — worse than the file we set out to shrink.
  if (!out.startsWith('data:image/jpeg')) return dataUrl
  // Pathological sources (already-tiny, high-noise) can grow. Keep the smaller.
  return out.length < dataUrl.length ? out : dataUrl
}

/**
 * Re-encode a data URL to at most `maxWidth` px wide, as `mime`.
 *
 * Used only by the quota fallback in studio-media-resize.client.ts: when
 * Cloudflare's transformation quota is exhausted the server cannot build the
 * -800/-ph renditions, so the browser builds them from the same bytes it is
 * about to upload. Returns undefined when the browser cannot produce the
 * requested format — the caller then leaves the renditions to the server.
 *
 * Images already narrower than maxWidth are re-encoded at their natural size,
 * never upscaled: the rendition KEY must exist for every image (the
 * r2-variants provider maps to it without probing), even when it is a
 * byte-for-byte-sized copy.
 */
export async function resizeImage(
  dataUrl: string,
  maxWidth: number,
  quality: number,
  mime = 'image/webp',
): Promise<string | undefined> {
  const bitmap = await createImageBitmap(dataUrlToBlob(dataUrl), { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxWidth / bitmap.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return undefined
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  // toDataURL silently falls back to PNG for a format it cannot encode (Safari
  // < 14 for WebP). A PNG under a .webp key would still render — the object is
  // served with the Content-Type we store — but it is far heavier than the
  // rendition is meant to be, so treat it as a failure.
  const out = canvas.toDataURL(mime, quality)
  return out.startsWith(`data:${mime}`) ? out : undefined
}

function dataUrlToBlob(dataUrl: string): Blob {
  // Decoded by hand rather than with fetch(dataUrl): the Studio CSP allows only
  // `connect-src 'self' <iconify>`, so fetching a data: URL would be blocked.
  const [meta = '', b64 = ''] = dataUrl.split(';base64,')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: meta.replace('data:', '') })
}
