/**
 * Warms the dev server before the first spec.
 *
 * Two cold costs otherwise land inside whichever test runs first, and both are
 * far larger than anything the specs are measuring:
 *   * Nitro compiles the studio routes on demand;
 *   * the media index (server/middleware/studio-media-index.ts) lists the R2
 *     bucket, which takes ~10 s a page through wrangler's remote-bindings proxy.
 *
 * Warming is best effort: a server without R2 bindings simply stays slow, and
 * the media specs skip themselves.
 */
const WARM_TIMEOUT = 180_000
const FAST_ENOUGH = 1_000

export default async function globalSetup() {
  const baseURL = process.env.E2E_BASE_URL || `http://localhost:${process.env.E2E_PORT || 3000}`

  await get(`${baseURL}/`)
  await get(`${baseURL}/__nuxt_studio/meta`)

  const deadline = Date.now() + WARM_TIMEOUT
  while (Date.now() < deadline) {
    const started = Date.now()
    const response = await get(`${baseURL}/__nuxt_studio/medias/:`)
    const elapsed = Date.now() - started
    // A listing that comes back promptly means the index is published and the
    // per-key metadata requests the editor makes will be served from memory.
    if (response && elapsed < FAST_ENOUGH) return
    await new Promise(resolve => setTimeout(resolve, 2_000))
  }
}

async function get(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    return response.ok
  }
  catch {
    return false
  }
}
