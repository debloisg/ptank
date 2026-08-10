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

// Longest edge kept. 2200 still covers a full-bleed hero on a 2x display; every
// smaller rendition is cut by Cloudflare Image Transformations at delivery.
const MAX_EDGE = 2200
const QUALITY = 0.82
// Below this, re-encoding costs more bytes than it saves: running the curated
// 2000px masters through canvas at q82 made them 4% BIGGER.
const SKIP_BELOW_BYTES = 600 * 1024

/**
 * Returns a downscaled JPEG data URL, or the input untouched when there is
 * nothing to gain. JPEG on purpose, not WebP: the stored file is the master,
 * and Cloudflare re-encodes it to AVIF/WebP per request anyway — storing lossy
 * WebP would make that a second lossy pass. Keeping the format also keeps the
 * file extension in the R2 key honest, since Studio derives it from the
 * original filename.
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

function dataUrlToBlob(dataUrl: string): Blob {
  // Decoded by hand rather than with fetch(dataUrl): the Studio CSP allows only
  // `connect-src 'self' <iconify>`, so fetching a data: URL would be blocked.
  const [meta = '', b64 = ''] = dataUrl.split(';base64,')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: meta.replace('data:', '') })
}
