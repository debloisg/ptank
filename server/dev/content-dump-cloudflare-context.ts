// DEV-ONLY middleware, registered from the `nitro:config` hook in nuxt.config.ts
// for the /__nuxt_content/:collection/sql_dump.txt route — and ONLY that route.
// It lives outside server/routes|api|middleware on purpose, so nitro never scans
// it into a production build.
//
// @nuxt/content's cloudflare dump handler prefers the ASSETS binding when it
// sees one (`event.context.cloudflare.env.ASSETS`), and the NuxtHub/wrangler
// dev proxy provides that binding in dev too — where it serves the local assets
// directory, which contains no dump files. The handler then returns "" for
// every collection instead of falling through to its nitro-storage path, the
// browser builds its client-side WASM database from an empty dump, and every
// client-side navigation to a content page 404s (SSR queries the real database,
// which is why a hard reload works).
//
// Dropping the cloudflare context for this one request makes the handler use
// nitro storage instead, which the `devStorage` remount in nuxt.config.ts
// points at the real dump directory (.nuxt/content/raw/).
//
// The route filter lives HERE, not in the registration: middleware routes are
// plain prefix matches in h3, so a `:collection` param in the registered route
// would never match. Other /__nuxt_content/* endpoints (the query POST) keep
// their cloudflare context — dev queries run against the proxied D1 binding.
//
// No leading /__nuxt_content in the pattern: h3 strips the middleware's base
// prefix from event.path, so inside this handler the path reads
// "/<collection>/sql_dump.txt".
const SQL_DUMP_PATH = /^\/[^/]+\/sql_dump\.txt(?:\?|$)/

export default defineEventHandler((event) => {
  if (SQL_DUMP_PATH.test(event.path)) {
    event.context.cloudflare = undefined
  }
})
