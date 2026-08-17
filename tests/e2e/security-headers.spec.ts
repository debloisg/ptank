import { expect, test } from '@playwright/test'

// The Studio editor does not get a document of its own: /_studio is a 302 into
// the auth flow that lands the editor back on an ORDINARY site page, and the
// panel mounts into it. So the policy that governs the code editor is the one
// served by the '/**' route rule — which is why esm.sh and `worker-src blob:`
// live on the public policy. When they did not, `import("https://esm.sh/
// modern-monaco")` was blocked and "use code editor" opened a blank panel.
const directive = (csp: string, name: string) =>
  csp.split(';').map(part => part.trim()).find(part => part.startsWith(`${name} `)) ?? ''

test.describe('content-security-policy', () => {
  test('site pages allow the editor to fetch monaco, but never unsafe-eval', async ({ request }) => {
    const response = await request.get('/evenements/octobre-rose-2026')
    const csp = response.headers()['content-security-policy']
    expect(csp, 'no CSP header on a site page').toBeTruthy()

    expect(directive(csp, 'script-src')).toContain('https://esm.sh')
    expect(directive(csp, 'connect-src')).toContain('https://esm.sh')
    expect(directive(csp, 'worker-src')).toContain('blob:')

    // The relaxation stops there: eval() stays confined to the Studio routes.
    expect(directive(csp, 'script-src')).not.toContain("'unsafe-eval'")
  })

  test('studio routes carry the relaxed policy', async ({ request }) => {
    const response = await request.get('/_studio', { maxRedirects: 0 })
    const csp = response.headers()['content-security-policy']
    expect(csp).toBeTruthy()
    expect(directive(csp, 'script-src')).toContain("'unsafe-eval'")
    expect(directive(csp, 'script-src')).toContain('https://esm.sh')
  })

  test('the service worker may fetch the R2 bucket it redirects to', async ({ request }) => {
    const response = await request.get('/sw.js')
    test.skip(!response.ok(), 'no service worker served in this environment')

    const csp = response.headers()['content-security-policy']
    expect(csp).toBeTruthy()
    // A service worker is governed by the CSP served with its OWN script, and
    // /images/** redirects to R2 — without this the editor's images all fail.
    expect(directive(csp, 'connect-src')).toContain('https://image.petanque-fouesnantaise.fr')
  })

  test('the baseline hardening headers are present', async ({ request }) => {
    const headers = (await request.get('/')).headers()
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['strict-transport-security']).toContain('max-age=')
  })
})
