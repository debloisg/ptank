import type { APIRequestContext, APIResponse } from '@playwright/test'
import { expect, test } from './fixtures/studio'

// Studio's media library is the R2 bucket (external media via the NuxtHub blob
// binding), not the local `public/` folder. Two regressions live here:
//   * the tab rendered "MEDIA 0" / "No images found" whenever the client was
//     wired to the dev filesystem storage instead of /__nuxt_studio/medias;
//   * `publicUrl` must stay ABSOLUTE — a relative one makes Studio's ipx proxy
//     treat every id as a filesystem path and 404 every thumbnail, and it is
//     also the string the picker writes into the document.
//
// Mind the cold-start cost: the panel indexes the bucket object by object, so
// an "empty" media tab in the first minute is indexing, not breakage. Only ONE
// test drives the UI, because each fresh profile pays that cost again — the
// wiring itself is asserted through a single, cheap metadata request.
const EVENT = '/evenements/octobre-rose-2026'
const SAMPLE_MEDIA = '/__nuxt_studio/medias/Affiche-octobrerose.jpg'

/**
 * Metadata for one known object in the bucket.
 *
 * Answered by an unconfigured environment (no R2 binding) with an error status,
 * which skips the test — but the dev server proxies through wrangler to the real
 * bucket, so a request can also stall behind Studio's own indexing traffic.
 * Hence: short per-attempt timeout, retried, rather than one long hang.
 */
async function mediaMeta(request: APIRequestContext): Promise<Record<string, string>> {
  let response: APIResponse | undefined
  await expect
    .poll(async () => {
      try {
        response = await request.get(SAMPLE_MEDIA, { timeout: 15_000 })
      } catch {
        return 'stalled'
      }
      // A definitive non-OK answer means the binding is missing, not slow.
      test.skip(!response.ok(), 'no R2 binding in this environment (see .env.example)')
      return 'ok'
    }, { timeout: 90_000, message: 'media metadata endpoint never answered' })
    .toBe('ok')

  return response!.json()
}

test.describe('studio media library', () => {
  test('media metadata comes from R2 with an absolute, single-prefixed path', async ({ request }) => {
    test.slow()
    const media = await mediaMeta(request)
    // This `path` is exactly what the picker inserts into the document.
    expect(media.path).toMatch(/^https:\/\//)
    expect(media.path.split('/images/').length - 1, `not a single /images/ prefix: ${media.path}`).toBe(1)
    expect(media.path).toMatch(/Affiche-octobrerose\.jpg$/)
  })

  test('the media tab lists bucket images, thumbnails and all', async ({ page, studio, request }) => {
    test.slow()
    await mediaMeta(request)

    const failedThumbnails: string[] = []
    page.on('response', response => {
      if (response.url().includes('/__nuxt_studio/ipx/') && response.status() >= 400) {
        failedThumbnails.push(`${response.status()} ${response.url()}`)
      }
    })

    await page.goto(EVENT)
    await studio.waitForMount()
    await studio.openMediaTab()

    // Rows render as `/images/<name>`; anything else means the client fell back
    // to the local filesystem storage.
    await studio.waitForMediaIndex()
    expect(failedThumbnails, `broken thumbnails:\n${failedThumbnails.join('\n')}`).toHaveLength(0)
  })
})
