import { test as base, expect, type Locator, type Page } from '@playwright/test'

/**
 * Studio panel driver.
 *
 * The editor mounts inside a `<nuxt-studio>` custom element with an OPEN shadow
 * root, which Playwright's selector engines pierce transparently — so the
 * locators below read like ordinary ones.
 *
 * Activation is seeded through localStorage rather than by walking the
 * /_studio → OAuth → back-to-the-site redirect chain: the panel reads
 * `studio-active` and `studio-preferences` at boot, and seeding them keeps
 * every test independent (no shared login, no ordering).
 */
export class StudioPanel {
  constructor(private readonly page: Page) {}

  get contentTab(): Locator {
    return this.page.getByText('Content', { exact: true }).first()
  }

  get mediaTab(): Locator {
    return this.page.getByText('Media', { exact: true }).first()
  }

  /** The `<nuxt-studio>` host is present as soon as the panel has mounted. */
  get root(): Locator {
    return this.page.locator('nuxt-studio')
  }

  async waitForMount() {
    // Cold dev server: the panel's chunks compile on demand and it only renders
    // once the session/activation round-trip is done.
    await expect(this.root).toBeAttached({ timeout: 120_000 })
    await expect(this.contentTab).toBeVisible({ timeout: 60_000 })
  }

  /**
   * Open a document from the content tree, e.g. ['Evenements', 'Octobre Rose 2026'].
   * The tree only appears once the content database has been queried, which on
   * a cold dev server is well past the default action timeout.
   */
  async openDocument(...path: string[]) {
    await this.contentTab.click()
    for (const segment of path) {
      await this.page.getByText(segment, { exact: true }).first().click({ timeout: 90_000 })
    }
  }

  async openMediaTab() {
    await this.mediaTab.click()
  }

  /** Any media row, rendered as its `/images/…` path. */
  get mediaEntries(): Locator {
    return this.page.getByText(/^\/images\/.+\.(jpe?g|png|webp)$/)
  }

  /**
   * The library renders nothing until Studio has indexed the bucket, and it
   * indexes by fetching metadata for EVERY object one by one (~2.4k requests
   * against remote R2 here). Cold — which every test profile is — that takes
   * the best part of a minute; afterwards it is cached in IndexedDB. So this
   * waits generously instead of failing on an empty-looking tab.
   */
  async waitForMediaIndex(timeout = 180_000) {
    await expect(this.mediaEntries.first()).toBeVisible({ timeout })
  }
}

type StudioFixtures = {
  /** Seeds Studio activation before any app script runs. */
  studio: StudioPanel
  /** Which editor the panel boots into. Override per test with `test.use`. */
  editorMode: 'tiptap' | 'code'
  /** Document the panel restores on boot (repo-relative path under content/). */
  studioDocument: string | null
}

export const test = base.extend<StudioFixtures>({
  editorMode: ['tiptap', { option: true }],
  // A document Studio can resolve. Not '/': the panel clears its own
  // activation flag when the restored fsPath does not resolve to a document,
  // and then never renders.
  studioDocument: ['evenements/octobre-rose-2026.md', { option: true }],

  studio: async ({ page, editorMode, studioDocument }, use) => {
    await page.addInitScript(
      ({ mode, fsPath }) => {
        localStorage.setItem(
          'studio-active',
          JSON.stringify({ active: true, feature: 'content', fsPath: fsPath ?? '/' }),
        )
        localStorage.setItem(
          'studio-preferences',
          JSON.stringify({
            syncEditorAndRoute: true,
            showTechnicalMode: false,
            editorMode: mode,
            debug: false,
            enableAICompletion: false,
          }),
        )
      },
      { mode: editorMode, fsPath: studioDocument },
    )

    await use(new StudioPanel(page))
  },
})

export { expect }
