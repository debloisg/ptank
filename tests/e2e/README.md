# End-to-end tests

Playwright suite guarding the Studio editor and the image pipeline.

```bash
pnpm test:e2e            # headless, reuses a dev server if one is running
pnpm test:e2e:ui         # Playwright UI mode
pnpm exec playwright show-report
```

First run only: `pnpm exec playwright install chromium`.

## What it covers

| Spec | Regression it guards |
| --- | --- |
| `public-images.spec.ts` | R2 URLs prefixed twice (`https://image…/https://image…/x.jpg`) after picking an image in Studio |
| `security-headers.spec.ts` | the CSP that governs the page hosting the editor — esm.sh + `worker-src blob:` on the public policy, `unsafe-eval` confined to `/_studio`, R2 in the service worker's own policy |
| `studio-media.spec.ts` | the media tab falling back to the local filesystem ("MEDIA 0" / "No images found") and 404ing thumbnails |
| `studio-code-editor.spec.ts` | "use code editor" opening a blank panel |

## How it runs

Against `nuxt dev`, not a production build:

- Studio is a dev-mode surface here — it writes to the local filesystem and
  skips the OAuth round-trip, which a preview build does not do.
- The media tab needs the real R2 bucket, which comes from wrangler's remote
  bindings (`"remote": true` in `wrangler.jsonc`) and only `nuxt dev` wires
  those up. It needs `CLOUDFLARE_ACCESS_CLIENT_ID` / `_SECRET` in `.env`;
  without them the media specs **skip** rather than fail.
- `nuxt build` while a dev server is live corrupts the dev content database, so
  the suite deliberately never builds.

`reuseExistingServer` is on outside CI: if you already have `pnpm dev` up, the
suite drives it instead of starting a second one.

Single worker: every spec shares that one dev server, and each fresh browser
profile makes Studio re-index the media bucket — it fetches metadata for every
object one by one (~2.4k requests against remote R2), which takes roughly a
minute. Run those concurrently and the dev server starves. This is also why an
"empty" media tab in the first minute means *indexing*, not breakage; the specs
wait it out, and the result is cached in IndexedDB per profile.

Playwright's artifacts (`test-results/`, `playwright-report/`) are listed in
`nuxt.config.ts` `ignore` — otherwise the dev server's file watcher reloads the
app the moment a screenshot is written, and the Studio panel unmounts mid-test.

## Conventions

- User-facing locators (`getByText`, `getByRole`) — no CSS paths into Studio's
  markup. Playwright pierces the open shadow root of `<nuxt-studio>`, so its
  internals are reachable without any special selector.
- Studio activation is seeded via `localStorage` in the `studio` fixture
  (`fixtures/studio.ts`), so specs stay independent and order-free.
- Web-first assertions (`toBeVisible`, `expect.poll`) rather than sleeps.

## The other suite: `pnpm test:unit` (`tests/node`)

Some failures are invisible from here on purpose. `nuxt dev` is Node; production
is Cloudflare Workers, where a promise still pending when the response is sent is
cancelled outright — it never resolves, never rejects, never reaches a `finally`.
The media library went permanently empty in production that way while every spec
in this directory stayed green.

So the media index's own logic lives in `server/utils/media-index.ts`, free of
Nitro, and `tests/node/media-index.spec.ts` drives it with a listing that simply
never settles. Same Playwright runner, no browser and no dev server:
`playwright.node.config.ts`.
