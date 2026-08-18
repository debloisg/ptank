import { defineConfig } from '@playwright/test'

// Unit suite: plain Node tests, no browser, no dev server — run with
// `pnpm test:unit`. It is a separate config because the e2e config boots a Nuxt
// dev server for every run, and the whole point of these specs is to cover the
// things a running dev server CANNOT show: the media index's behaviour on
// Cloudflare Workers, where background promises are cancelled mid-flight.
export default defineConfig({
  testDir: './tests/node',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github']] : [['list']],
  // These are in-process and deal in milliseconds; a spec that runs long is a
  // spec that hangs, which is exactly the bug under test.
  timeout: 15_000,
  expect: { timeout: 5_000 },
})
