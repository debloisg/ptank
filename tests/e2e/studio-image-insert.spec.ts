import { ContentFile } from './fixtures/content'
import { expect, test } from './fixtures/studio'

// Inserting an image from the rich-text editor: `/image` → the media picker →
// a picked file that renders in the preview. Reported broken as "no picker
// spawns", which is why the dialog itself is asserted separately from the
// insertion that follows it.
const EVENT = '/evenements/octobre-rose-2026'
const DOCUMENT = 'content/evenements/octobre-rose-2026.md'
const R2_HOST = 'https://image.petanque-fouesnantaise.fr'

test.use({ editorMode: 'tiptap', studioDocument: 'evenements/octobre-rose-2026.md' })

const document_ = new ContentFile(DOCUMENT)

test.beforeEach(async () => {
  // Dev-mode Studio writes straight to disk — snapshot so the repo is left as found.
  await document_.snapshot()
})

test.afterEach(async () => {
  await document_.restore()
})

test.describe('inserting an image from the rich-text editor', () => {
  test('the /image slash command opens the media picker', async ({ studio }) => {
    test.slow()
    await studio.goto(EVENT)
    await studio.waitForMount()
    await studio.openDocument('Evenements', 'Octobre Rose 2026')

    await studio.focusEndOfDocument()
    await studio.runSlashCommand('image', 'Image')

    await expect(studio.imagePicker).toBeVisible({ timeout: 30_000 })
  })

  test('a picked image lands in the document and renders in the preview', async ({ page, studio }) => {
    test.slow()
    await studio.goto(EVENT)
    await studio.waitForMount()
    await studio.openDocument('Evenements', 'Octobre Rose 2026')

    await studio.focusEndOfDocument()
    await studio.runSlashCommand('image', 'Image')
    await studio.pickImage('Affiche-octobrerose')

    // The preview is the site itself: the image must actually load, not just
    // exist — a double-prefixed URL still yields a visible <img> box.
    const preview = page.locator(`#__nuxt img[src*="Affiche-octobrerose"]`).last()
    await expect(preview).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(() => preview.evaluate(img => (img as HTMLImageElement).naturalWidth), { timeout: 30_000 })
      .toBeGreaterThan(0)

    // …and it must reach the file with a single, absolute R2 URL.
    await expect
      .poll(() => document_.read(), { timeout: 30_000 })
      .toContain(`![`)
    const markdown = await document_.read()
    const inserted = markdown.match(/!\[[^\]]*\]\(([^)]+)\)/g) ?? []
    expect(inserted.length).toBeGreaterThan(0)
    for (const image of inserted) {
      expect(image.split(R2_HOST).length - 1, `double-prefixed: ${image}`).toBeLessThanOrEqual(1)
      // A URL the picker wrote must be usable as-is. A stray trailing slash
      // (`…/Affiche.jpg/`) 404s on R2 and shows a broken image on the live page,
      // while still passing every "looks like a URL" check.
      expect(image, `not a usable file URL: ${image}`).toMatch(/\.(jpe?g|png|webp|gif)\)$/i)
    }
  })

  // Every keystroke re-renders the preview, which remounts its images. With a
  // blur placeholder set, each remount paints the 24px placeholder before the
  // real file — so the whole article flickered while an editor typed.
  test('typing does not make the preview images blink', async ({ page, studio }) => {
    test.slow()
    await studio.goto(EVENT)
    await studio.waitForMount()
    await studio.openDocument('Evenements', 'Octobre Rose 2026')

    // Count placeholders as they are INSERTED: the swap to the real file is
    // fast, so anything sampled after the fact has already been replaced.
    await page.evaluate(() => {
      const win = window as unknown as { __placeholders: number }
      win.__placeholders = 0
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue
            const images = [...(node.matches('img') ? [node] : []), ...node.querySelectorAll('img')]
            for (const image of images) {
              if ((image.getAttribute('src') ?? '').includes('-ph.webp')) win.__placeholders++
            }
          }
        }
      }).observe(document.body, { childList: true, subtree: true })
    })

    await studio.editorBody.click()
    await page.keyboard.type('non-regression')
    await page.waitForTimeout(3_000)

    expect(await page.evaluate(() => (window as unknown as { __placeholders: number }).__placeholders))
      .toBe(0)
  })
})
