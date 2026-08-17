import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures/studio'

// Uploading through Studio's media tab must produce the three files the site
// renders from — and produce them at the RIGHT SIZE. They used to be byte-copies
// of the original: the keys existed, the picker looked fine, and every visitor
// downloaded a full-size image behind a `-800.webp` name.
//
//   <name>.<ext>     <= 1600 px, WebP bytes under the original extension
//   <stem>-800.webp  800 px srcset rendition
//   <stem>-ph.webp   ~24 px blur placeholder
//
// Locally the renditions come from the BROWSER (app/utils/studio-renditions.ts):
// `nuxt dev` has no Cloudflare in front of it, so the transformation probe fails
// and the client-side fallback is what runs — which is exactly the path this
// asserts. In production the same three keys are written by
// server/plugins/studio-media-variants.ts instead.
//
// This uploads to the REAL bucket (dev binds production R2 on purpose), so the
// spec deletes what it made.
const EVENT = '/evenements/octobre-rose-2026'
const R2_HOST = 'https://image.petanque-fouesnantaise.fr'
const SOURCE = `${R2_HOST}/images/Affiche-octobrerose.jpg`

const MAX_BASE_WIDTH = 1600
const SRCSET_WIDTH = 800
const PLACEHOLDER_WIDTH = 24

test.use({ editorMode: 'tiptap', studioDocument: 'evenements/octobre-rose-2026.md' })

/** Natural width of an image URL, measured in the page (img-src allows R2; fetch would not). */
async function widthOf(page: Page, url: string): Promise<number> {
  return page.evaluate(src => new Promise<number>((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img.naturalWidth)
    img.onerror = () => resolve(0)
    img.src = `${src}?cache-bust=${Date.now()}`
  }), url)
}

test.describe('uploading an image through Studio', () => {
  let uploadName: string
  let keys: string[] = []

  test.beforeEach(() => {
    uploadName = `e2e-upload-${Date.now()}`
    keys = [`${uploadName}.jpg`, `${uploadName}-800.webp`, `${uploadName}-ph.webp`]
  })

  test.afterEach(async ({ request }) => {
    // Best effort: a leftover test object in the production bucket is noise for
    // the editors who browse it.
    for (const key of keys) {
      await request.delete(`/__nuxt_studio/medias/${key}`, { timeout: 30_000 }).catch(() => {})
    }
  })

  test('produces base, -800 and -ph renditions at the right sizes', async ({ page, studio, request }) => {
    test.slow()

    // A real photo rather than a synthetic gradient: the encoders behave the
    // same, but a broken decode is obvious in the trace.
    const source = await request.get(SOURCE, { timeout: 60_000 })
    test.skip(!source.ok(), 'source image unavailable')
    const file = join(tmpdir(), `${uploadName}.jpg`)
    await writeFile(file, await source.body())

    await studio.goto(EVENT)
    await studio.waitForMount()
    const sourceWidth = await widthOf(page, SOURCE)
    expect(sourceWidth).toBeGreaterThan(0)

    // The MEDIA tab, not the content tree: the upload input in the content tree
    // belongs to the document draft, which has no upload of its own.
    await studio.openMediaTab()
    await studio.waitForMediaIndex()

    // Straight onto the hidden <input type="file">: the visible button exists to
    // open the OS chooser, which has nothing to do with what is under test.
    await page.locator('nuxt-studio input[type=file]').first().setInputFiles(file)

    // The base PUT lands first; the browser-built renditions follow it.
    for (const key of keys) {
      await expect
        .poll(async () => (await request.get(`/__nuxt_studio/medias/${key}`, { timeout: 30_000 })).status(), {
          timeout: 120_000,
          message: `${key} never reached the bucket`,
        })
        .toBe(200)
    }

    // Sizes: the whole point. A rendition as wide as the original means the
    // resize silently did nothing.
    const [base, srcset, placeholder] = await Promise.all(
      keys.map(key => widthOf(page, `${R2_HOST}/images/${key}`)),
    )

    expect(base, 'base rendition missing').toBeGreaterThan(0)
    expect(base).toBeLessThanOrEqual(MAX_BASE_WIDTH)
    if (sourceWidth > MAX_BASE_WIDTH) expect(base).toBeLessThan(sourceWidth)

    expect(srcset).toBeGreaterThan(0)
    expect(srcset).toBeLessThanOrEqual(SRCSET_WIDTH)
    expect(srcset, `-800 rendition is ${srcset}px, not a real resize`).toBeLessThanOrEqual(base)

    expect(placeholder).toBeGreaterThan(0)
    expect(placeholder).toBeLessThanOrEqual(PLACEHOLDER_WIDTH)

    // …and the renditions really are WebP, whatever the base key's extension says.
    for (const key of keys.slice(1)) {
      const head = await request.head(`${R2_HOST}/images/${key}`, { timeout: 30_000 })
      expect(head.headers()['content-type']).toContain('image/webp')
    }
  })
})
