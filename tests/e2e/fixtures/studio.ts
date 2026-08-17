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

  /**
   * Navigate, retrying on ERR_ABORTED.
   *
   * In dev the app awaits R2 through wrangler's remote-bindings proxy, which
   * intermittently answers `internal error` under load; a navigation started in
   * that window is aborted rather than answered. Retrying is what an editor
   * does too — it is not what these specs are testing.
   */
  async goto(path: string, attempts = 3) {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.page.goto(path, { timeout: 60_000 })
        return
      }
      catch (error) {
        if (attempt >= attempts) throw error
        await this.page.waitForTimeout(3_000)
      }
    }
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

  /** The rich-text editor body (the tiptap surface, not Page Settings). */
  get editorBody(): Locator {
    return this.page.locator('nuxt-studio .tiptap, nuxt-studio [contenteditable="true"]').first()
  }

  /** The media picker dialog opened from the editor or from Page Settings. */
  get imagePicker(): Locator {
    return this.page.getByText('Choose an image from your media library').first()
  }

  /**
   * Put the caret at the very end of the document and start a fresh paragraph,
   * which is where a `/command` is typed from.
   */
  async focusEndOfDocument() {
    await this.editorBody.click()
    await this.page.keyboard.press('Control+End')
    await this.page.keyboard.press('Enter')
  }

  /**
   * Run a slash command, e.g. `/image`, and pick its menu entry.
   *
   * `visible: true` matters: "Image" is also the label of the frontmatter field
   * inside the collapsed Page Settings, and that hidden one comes first in DOM
   * order.
   */
  async runSlashCommand(command: string, entry: string) {
    await this.page.keyboard.type(`/${command}`)
    await this.menuItem(entry).click({ timeout: 30_000 })
  }

  menuItem(label: string): Locator {
    return this.page.getByText(label, { exact: true }).filter({ visible: true }).first()
  }

  /** Every thumbnail in the picker — they are served through Studio's ipx proxy. */
  get pickerTiles(): Locator {
    return this.page.locator('nuxt-studio img[src*="__nuxt_studio/ipx"]')
  }

  /**
   * Pick the first media whose path matches, from an already open picker.
   *
   * Waits for the library to have ANY tile before searching: Studio fills its
   * media store asynchronously after the panel boots, and a search typed into
   * an empty store renders "No images available in your media library" — the
   * cold-start state, not a missing file.
   */
  async pickImage(search: string) {
    await expect(this.imagePicker).toBeVisible({ timeout: 30_000 })
    await expect(this.pickerTiles.first()).toBeVisible({ timeout: 120_000 })

    await this.page.getByPlaceholder(/search/i).filter({ visible: true }).first().fill(search)
    // Scoped to picker tiles: the preview pane may already show the same file.
    const tile = this.pickerTiles.and(this.page.locator(`[src*="${search}" i]`)).first()
    await expect(tile).toBeVisible({ timeout: 60_000 })
    await tile.click()
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
