import { defineConfig, devices } from '@playwright/test'

// End-to-end suite — see tests/e2e/README.md for what it covers and why.
//
// It runs against `nuxt dev`, not a production build, on purpose:
//   * the Studio editor is a DEV-mode surface here (local filesystem writes,
//     no OAuth round-trip), so a preview build cannot exercise it;
//   * the R2 bindings the media tab needs come from wrangler's remote bindings,
//     which only `nuxt dev` wires up (wrangler.jsonc `"remote": true`);
//   * `nuxt build` while a dev server is live corrupts the dev content DB.
// `reuseExistingServer` means a dev server you already have running is used as
// is — that is the normal local path, and it keeps the suite off the build.
const PORT = Number(process.env.E2E_PORT || 3000)
const baseURL = process.env.E2E_BASE_URL || `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  // Pays the dev server's cold costs once, before the first spec.
  globalSetup: './tests/e2e/global-setup.ts',
  // Every spec is independent: no shared editor state, no ordering.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // One worker on purpose. All specs share a single dev server, and each cold
  // Studio profile re-indexes the media bucket (thousands of metadata requests
  // against remote R2); running those concurrently starves the dev server and
  // turns a 3-minute suite into a timeout.
  workers: 1,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  // The Studio panel boots a content database and (in code mode) fetches
  // monaco from a CDN, so it is slower than a plain page test.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  // Chromium only: the editor is an internal tool used on desktop Chrome, and
  // the public-site assertions here are about URLs and headers, not rendering
  // quirks. Add browsers when there is a cross-browser bug worth guarding.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    command: 'pnpm dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    // Cold start compiles the whole app and connects wrangler's remote bindings.
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
