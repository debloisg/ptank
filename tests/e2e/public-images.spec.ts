import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'

// Images live in R2 and are referenced by ABSOLUTE URL once Studio has picked
// them (`image: https://image.…/images/x.jpg`). The regression these tests
// guard: the @nuxt/image provider and the og:image helper used to prepend the
// R2 base a second time, producing
// `https://image.…fr/https://image.…fr/images/x.jpg` — a broken link on every
// page that had a picked image.
const R2_HOST = 'https://image.petanque-fouesnantaise.fr'
const EVENT = '/evenements/octobre-rose-2026'

test.describe('public site images', () => {
  test('every image resolves to a single, absolute R2 URL', async ({ page }) => {
    await page.goto(EVENT)

    const sources = await page.locator('img').evaluateAll(imgs =>
      imgs.map(img => (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src),
    )
    expect(sources.length).toBeGreaterThan(0)

    for (const src of sources) {
      // The host may appear at most once — twice means the base was prepended
      // to an already-absolute URL.
      expect(src.split(R2_HOST).length - 1, `double-prefixed: ${src}`).toBeLessThanOrEqual(1)
      expect(src, `nested protocol: ${src}`).not.toMatch(/https?:\/\/[^/]+\/https?:\/\//)
    }
  })

  test('the picked frontmatter image renders as the page hero', async ({ page }) => {
    await page.goto(EVENT)

    const hero = page.locator('img').first()
    await expect(hero).toBeVisible()
    // naturalWidth > 0 is the only proof the bytes actually arrived; a broken
    // URL still yields a visible <img> box.
    await expect
      .poll(() => hero.evaluate(img => (img as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0)
  })

  // A concours poster is portrait, and the article hero used to be a fixed
  // 4/3 (mobile) / 16/9 (desktop) `object-cover` box: it cropped the affiche to
  // a strip, cutting off the date and the registration details — the two things
  // the poster exists to say. Portrait heroes are now shown whole.
  test('a portrait hero is shown whole, not cropped to the landscape box', async ({ page }) => {
    await page.goto(EVENT)

    const hero = page.getByRole('img', { name: /octobre rose/i }).first()
    await expect(hero).toBeVisible()

    const box = await heroBox(hero)
    test.skip(box.naturalHeight <= box.naturalWidth, 'hero image is not portrait')

    // Whole means the rendered box keeps the file's own aspect ratio; a cover
    // crop would pin it to the container's instead. 2% covers rounding on
    // fractional layout sizes.
    //
    // Polled, because orientation is only known once the file has been decoded:
    // the page reserves the landscape box and swaps to the portrait one on load,
    // so a single sample can catch the reserved state.
    const natural = box.naturalWidth / box.naturalHeight
    await expect
      .poll(async () => {
        const current = await heroBox(hero)
        return Math.abs(current.clientWidth / current.clientHeight - natural) / natural
      }, { timeout: 15_000, message: `hero stays cropped (natural ratio ${natural})` })
      .toBeLessThan(0.02)
  })

  test('og:image is absolute and not double-prefixed', async ({ page }) => {
    await page.goto(EVENT)

    const ogImage = await page
      .locator('meta[property="og:image"]')
      .first()
      .getAttribute('content')

    if (!ogImage) test.skip(true, 'no og:image on this page')
    expect(ogImage!).toMatch(/^https?:\/\//)
    expect(ogImage!).not.toMatch(/https?:\/\/[^/]+\/https?:\/\//)
  })
})

/** Rendered box and intrinsic size of an image, once its bytes have arrived. */
async function heroBox(hero: Locator) {
  await expect
    .poll(() => hero.evaluate(img => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0)
  return hero.evaluate((img) => {
    const el = img as HTMLImageElement
    return {
      naturalWidth: el.naturalWidth,
      naturalHeight: el.naturalHeight,
      clientWidth: el.clientWidth,
      clientHeight: el.clientHeight,
    }
  })
}
