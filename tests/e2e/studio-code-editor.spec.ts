import { expect, test } from './fixtures/studio'

// "Use code editor" lazily imports modern-monaco from esm.sh. It used to open a
// blank panel because the page's CSP had no esm.sh (see
// security-headers.spec.ts), so this spec asserts the editor actually mounts —
// the header test alone would pass against a panel that still fails to render.
const EVENT = '/evenements/octobre-rose-2026'

test.use({ editorMode: 'code', studioDocument: 'evenements/octobre-rose-2026.md' })

test.describe('studio code editor', () => {
  test('monaco mounts and shows the document source', async ({ page, studio }) => {
    const blocked: string[] = []
    page.on('console', message => {
      const text = message.text()
      if (/Refused to (load|connect|create)/i.test(text)) blocked.push(text)
    })

    await page.goto(EVENT)
    await studio.waitForMount()
    await studio.openDocument('Evenements', 'Octobre Rose 2026')

    // Monaco renders the frontmatter as syntax-highlighted lines; the aria
    // container it appends to <body> is its most stable mount signal.
    await expect(page.locator('.monaco-editor, #monaco-aria-container')).toBeAttached({
      timeout: 60_000,
    })
    await expect(page.getByText('title:', { exact: false }).first()).toBeVisible()

    expect(blocked, `CSP blocked the editor:\n${blocked.join('\n')}`).toHaveLength(0)
  })
})
