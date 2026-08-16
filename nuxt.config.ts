// https://nuxt.com/docs/api/configuration/nuxt-config
import { fileURLToPath } from 'node:url'

// Images are served straight from R2, pre-sized and WebP-encoded before upload.
// See the `image` block below and the "Images" section of the README.
// Public domain of the R2 bucket that holds /images/** — the bucket's custom
// domain on the site's own zone. Defaults to it so the Cloudflare Workers build
// (and dev) render images without a build-time env var; the deploy bundles no
// image originals, so an empty base = broken images. Override with
// NUXT_IMAGE_R2_BASE (e.g. a pub-xxx.r2.dev URL) if the bucket moves off-zone.
// Trimmed + de-slashed: a stray space or trailing "/" pasted into the Cloudflare
// build variable would otherwise be concatenated into every image URL
// ("…fouesnantaise.fr /images/x.jpg") and break every image on the site.
const r2Base = (process.env.NUXT_IMAGE_R2_BASE || 'https://image.petanque-fouesnantaise.fr')
  .trim()
  .replace(/\/+$/, '')

const siteUrl = (process.env.NUXT_PUBLIC_SITE_URL || 'https://petanque-fouesnantaise.fr')
  .trim()
  .replace(/\/+$/, '')
// ── Content-Security-Policy ────────────────────────────────────────────────
// Two policies: a strict one for the public site, a relaxed one for the Studio
// editor. ENFORCED since Aug 2026 — the values were derived from the
// violations a report-only pass logged before the switch.
//
// `script-src` keeps 'unsafe-inline' because the pages are prerendered static
// HTML: there is no per-request step in which to mint a nonce, and Nuxt inlines
// its hydration payload. That's the remaining weak point of this policy.

const cspBase = [
  "default-src 'self'",
  `img-src 'self' data: ${r2Base} ${siteUrl} https://avatars.githubusercontent.com`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
]

// api.iconify.design: @nuxt/icon fetches icon sets from there at runtime for any
// icon missing from the client bundle. The alternative is bundling every icon
// locally, which inflates the Worker — kept remote, so the host is allowlisted.
const ICONIFY = 'https://api.iconify.design'

// Cloudflare Web Analytics: free, cookieless (sets no identifiers, so it needs no
// consent banner under GDPR). Loads only when the token is provided — dev, forks
// and previews stay beacon-free. Token: Cloudflare → Analytics & Logs → Web
// Analytics → add a site.
const cfBeaconToken = process.env.NUXT_PUBLIC_CF_BEACON_TOKEN?.trim()
const CF_INSIGHTS = 'https://static.cloudflareinsights.com'

// Social-share image. There is no dynamic OG renderer (satori/wasm would blow the
// Worker past the free-tier size limit), so this is one existing photo cropped to
// the 1200x630 OG canvas by Cloudflare Image Transformations — free, no new asset
// to maintain. f=jpeg on purpose: Facebook/WhatsApp/Slack scrapers don't send an
// Accept header advertising AVIF/WebP, and some reject them outright.
const OG_IMAGE_SOURCE = '/images/hero-terrain.jpg'
const ogImage = `${siteUrl}/cdn-cgi/image/w=1200,h=630,fit=cover,f=jpeg,q=80/${r2Base}${OG_IMAGE_SOURCE}`

// Non-CSP security headers, identical on every route.
const securityHeaders = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
}

const publicCsp = [
  ...cspBase,
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' ${CF_INSIGHTS}`,
  `connect-src 'self' ${ICONIFY} https://cloudflareinsights.com https://api.github.com`,
].join('; ')

const studioCsp = [
  ...cspBase,
  // 'unsafe-eval' + 'wasm-unsafe-eval': the editor evaluates strings and
  // instantiates WebAssembly. worker-src: it registers /sw.js.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  `connect-src 'self' ${ICONIFY} https://api.github.com`,
].join('; ')

export default defineNuxtConfig({
  // @nuxthub/core must come BEFORE nuxt-studio (Studio detects its blob
  // storage to enable external media uploads → R2). @nuxt/image is before
  // @nuxt/ui so Nuxt UI renders <UBlogPost>/<ProseImg>/etc. through NuxtImg.
  // @nuxtjs/seo = sitemap + robots + schema.org + canonical/OG meta.
  // nuxt-a11y runs axe-core in the dev console only (no prod overhead).
  // @nuxt/eslint generates the flat-config base that eslint.config.mjs extends,
  // so the lint rules know about auto-imports, `#imports`, page/component dirs.
  modules: ['@nuxthub/core', '@nuxt/image', '@nuxt/content', '@nuxt/ui', '@nuxtjs/seo', 'nuxt-a11y', 'nuxt-studio', '@nuxt/eslint'],
  css: ['~/assets/css/main.css'],

  // Strict TS everywhere. typeCheck stays OFF for `nuxt build` on purpose: it
  // would add vue-tsc to every Cloudflare deploy build (slower, and a type error
  // in content types could block a content-only deploy). Run it explicitly with
  // `pnpm typecheck` instead.
  typescript: {
    strict: true,
    typeCheck: false,
  },

  // ESLint config generated for this project (extended by eslint.config.mjs).
  // stylistic: false — formatting is not policed, only correctness.
  eslint: {
    config: {
      stylistic: false,
    },
  },
  devtools: { enabled: true },
  // Recent date so Nitro selects the modern `cloudflare_module` preset
  // (nodejs_compat) instead of `cloudflare-module-legacy`, whose polyfill
  // injection fails to parse unhead's iife bundle. Matches wrangler.jsonc.
  compatibilityDate: '2026-07-20',

  // Cloudflare Workers (with static assets) deploy target. One Worker serves both the
  // public site and the Studio editor; the Studio routes (/_studio, /__nuxt_studio/*)
  // are gated by Cloudflare Access on this hostname (see README / Access config).
  // Hybrid rendering: pages prerendered to static HTML, dynamic routes run at the edge.
  // Runtime bindings (D1 `DB`, static assets) live in wrangler.jsonc.
  nitro: {
    preset: 'cloudflare_module',
    prerender: {
      crawlLinks: true,
      routes: ['/'],
    },
    // Half of the dev-only fix for client-side navigation 404s on content pages
    // (the other half is the middleware in hooks['nitro:config'] below, where
    // the full story is told): @nuxt/content's cloudflare dump handler falls
    // back to `build:content:raw:…` in nitro storage, but that mount points at
    // NITRO's build dir (.nuxt/dev) while the dumps are templated into NUXT's
    // (.nuxt/content/raw). Remount just that prefix onto the real directory.
    // Dev-only by design: devStorage is ignored in production builds.
    devStorage: {
      'build:content:raw': {
        driver: 'fs',
        base: fileURLToPath(new URL('./.nuxt/content/raw', import.meta.url)),
      },
    },
    // Studio's tiptap editor renders markdown `![](/images/…)` against the
    // worker origin directly (it bypasses @nuxt/image's R2 alias), so image
    // previews 404. Redirect worker-origin /images/** to the R2 bucket so the
    // editor resolves them. Invisible to the public site — its <NuxtImg> already
    // emits full R2-domain URLs and never hits this path.
    routeRules: {
      '/images/**': { redirect: { to: `${r2Base}/images/**`, statusCode: 302 } },
      // ── Security headers ────────────────────────────────────────────────
      // The site shipped with none of these. Each one below is inert for a
      // correctly-behaving page and only closes an attack:
      //   HSTS               — pin HTTPS for a year (Cloudflare already
      //                        redirects, but the first plain-HTTP request is
      //                        interceptable until the browser has this).
      //   nosniff            — stop MIME-sniffing an upload into a script.
      //   frame-ancestors    — no framing at all: the Studio login page being
      //                        iframeable is a clickjacking route to the CMS.
      //   referrer-policy    — don't leak full URLs to third parties.
      //   permissions-policy — deny camera/mic/geolocation outright.
      // CSP is ENFORCED (was report-only through Aug 2026; the policies were
      // tightened from the violations that pass logged — 'wasm-unsafe-eval' for
      // the client-side content database, the R2 img-src, iconify connect-src).
      '/**': {
        headers: { ...securityHeaders, 'content-security-policy': publicCsp },
      },
      // Studio's editor legitimately needs what the public site must never have:
      // eval() and WebAssembly (its markdown/tiptap tooling), plus a service
      // worker. Rather than weaken the whole site to accommodate the CMS, relax
      // the policy only on these paths — which Cloudflare Access already gates,
      // so only signed-in editors can reach them.
      // Each rule repeats the full header set on purpose: a browser that receives
      // TWO CSPs enforces the INTERSECTION of them, so a leftover strict policy
      // alongside the relaxed one would still block Studio's eval.
      // '/_studio' AND '/_studio/**': nitro's `/**` glob does not match the bare
      // path itself, and the bare path is the editor page.
      '/_studio': {
        headers: { ...securityHeaders, 'content-security-policy': studioCsp },
      },
      '/_studio/**': {
        headers: { ...securityHeaders, 'content-security-policy': studioCsp },
      },
      '/__nuxt_studio/**': {
        headers: { ...securityHeaders, 'content-security-policy': studioCsp },
      },
    },
    // Cloudflare presets replace `typeof window` → `"undefined"`. unhead ships
    // JS-as-a-string (streamingIifeCode) that contains the text `typeof window`;
    // the double-quoted replacement corrupts that string literal and breaks the
    // Rollup parse. Backticks evaluate the same but don't terminate a "…" string.
    // See https://github.com/nitrojs/nitro/issues/3071
    replace: {
      'typeof window': '`undefined`',
    },
  },

  hooks: {
    // Dev-only middleware on the content dump route — the other half of the
    // devStorage remount in the nitro block above.
    //
    // In dev, every client-side navigation to a content page 404'd while a hard
    // reload worked. Chain: the explicit cloudflare_module preset makes
    // @nuxt/content register its *cloudflare* sql_dump handler even in dev; the
    // NuxtHub/wrangler dev proxy exposes an ASSETS binding
    // (event.context.cloudflare.env.ASSETS, from the `assets` binding in
    // wrangler.jsonc); the handler prefers that binding and fetches
    // /dump.<collection>.sql from it — but in dev that assets store has no dump
    // files, so every collection dumps as "". The browser then builds its
    // client-side WASM database from an empty dump and every client-side query
    // returns nothing, which pages surface as a 404 (SSR queries the real
    // database, hence ctrl+r "fixing" it).
    //
    // The middleware strips the cloudflare context for exactly this route, so
    // the handler falls through to nitro storage, which the devStorage remount
    // points at the real dumps. Registered here rather than in server/middleware
    // so it can never ship to production: the handler file lives in server/dev/,
    // which nitro does not scan.
    'nitro:config'(nitroConfig) {
      if (!nitroConfig.dev) return
      nitroConfig.handlers ||= []
      // Prefix route only: middleware matching in h3 is a plain prefix, params
      // like :collection never match. The handler narrows to sql_dump.txt itself.
      nitroConfig.handlers.push({
        route: '/__nuxt_content',
        middleware: true,
        handler: fileURLToPath(new URL('./server/dev/content-dump-cloudflare-context.ts', import.meta.url)),
      })
    },
  },

  // Register the terracotta accent so `color="secondary"` works alongside navy.
  ui: {
    theme: {
      colors: ['primary', 'secondary', 'success', 'info', 'warning', 'error'],
    },
  },

  // Editorial cream design is light-only.
  colorMode: {
    preference: 'light',
    fallback: 'light',
  },

  // Align the build's markdown parse with nuxt-studio, which hardcodes
  // remark-mdc `autoUnwrap: true` (dist/.../document/generate.js). The @nuxt/content
  // build otherwise parses with autoUnwrap OFF, so single-paragraph MDC-component
  // bodies (callout/card/accordion-item) are stored in D1 wrapped as `["p",…]` while
  // Studio parses them unwrapped — an AST mismatch Studio reports as a phantom
  // "conflict" on every file (unfixable by any text formatting). Matching it here
  // makes D1 == Studio's parse. Paired with the single @nuxtjs/mdc version pinned in
  // pnpm-workspace.yaml. NOTE: unwraps the <p> around single-paragraph MDC bodies.
  content: {
    build: {
      markdown: {
        remarkPlugins: {
          'remark-mdc': { options: { autoUnwrap: true } },
        },
      },
    },
  },

  // ── Images (R2, served raw — no edge transforms) ─────────────────────────
  // The image originals live in R2, NOT in /public — they are never copied
  // into the deploy bundle (source files are kept in /image-sources purely to
  // upload from; see scripts/upload-images-to-r2.sh). NUXT_IMAGE_R2_BASE (the
  // bucket's public domain) is therefore required to see images anywhere,
  // dev included — set it in .env locally.
  //
  // Every image is served straight out of R2 as a pre-built file — never
  // through an edge transform. Cloudflare bills Image Transformations per UNIQUE
  // transformation, and "the first request for each unique version within a
  // calendar month is billed as one unique transformation, REGARDLESS OF CACHE
  // STATUS" (Cloudflare pricing docs). Caching therefore cannot lower the bill;
  // the only lever is emitting fewer distinct transformed URLs, and ~2700
  // archive photos and article images with a responsive srcset each blew well
  // past the 5,000/month free tier.
  //
  // So sizing happens BEFORE the bucket instead of at the edge. Every image has
  // exactly three pre-built objects: the base (<=1600px WebP), a -800.webp
  // srcset rendition and a -ph.webp blur placeholder:
  //   - the archive/gallery corpora and /image-sources masters are built offline
  //     (scripts/optimize-archive-images.mjs, scripts/generate-galerie-tiles.mjs,
  //     scripts/generate-image-variants.mjs);
  //   - Studio uploads get the same three objects generated at upload time.
  //
  // The custom provider maps width requests onto those files with a pure string
  // rewrite (see app/providers/r2-variants.ts) — srcset works, nothing is
  // computed at the edge.
  //
  // The one remaining edge-transform use is the ARTICLE og:image URLs, built by
  // hand as /cdn-cgi/image/… (see below and pages/[...slug].vue): a bounded set
  // of a few hundred uniques a month, and social scrapers want a JPEG crop no
  // stored file matches. (Album pages just point og:image at the raw cover.)
  image: {
    provider: 'r2Variants',
    providers: {
      r2Variants: {
        name: 'r2Variants',
        provider: fileURLToPath(new URL('./app/providers/r2-variants.ts', import.meta.url)),
        options: { baseURL: r2Base },
      },
    },
    // Opt-in per image via provider="cloudflare": real edge transforms for the
    // FEW images worth a unique-transformation budget (the homepage hero — the
    // LCP element of the most-visited page: per-width AVIF/WebP via f=auto).
    // A handful of uniques/month; the blanket no-transform rule above exists
    // because of the 2,700-image corpus, not because transforms are banned.
    // Callers must pass `:modifiers="{ onerror: 'redirect' }"`: when the free
    // quota is exhausted (ERROR 9422 — the founding incident of this config),
    // the transform URL then 307s to the original file instead of returning a
    // text error, so the image degrades to its untransformed self.
    cloudflare: {
      baseURL: siteUrl,
    },
  },

  // ── SEO (@nuxtjs/seo) ───────────────────────────────────────────────────
  // Drives sitemap.xml, robots.txt, schema.org JSON-LD and canonical/OG tags.
  // Defaults to the live apex domain; NUXT_PUBLIC_SITE_URL can override it
  // (e.g. a preview deployment).
  site: {
    url: siteUrl,
    name: 'Pétanque Fouesnantaise',
    description:
      'Club de pétanque à Fouesnant (29) — actualités, événements, compétitions, résultats et adhésion.',
    defaultLocale: 'fr',
  },
  // Dynamic OG image rendering (satori wasm) would push the Worker past the
  // Cloudflare free-tier size limit — disabled. The static og:image below covers
  // social sharing instead.
  ogImage: { enabled: false },

  // Exposed so pages can build absolute /cdn-cgi/image/… URLs for their own
  // og:image (see pages/[...slug].vue) without re-deriving the R2 origin.
  runtimeConfig: {
    public: {
      imageR2Base: r2Base,
    },
  },


  // Sitemap: emit <lastmod> so crawlers can tell what actually changed. Dates
  // come from each entry's frontmatter `date` (see content.config.ts).
  sitemap: {
    discoverImages: false,
  },

  // Nuxt Studio — the in-browser CMS non-coders use to edit content, at /_studio.
  // SECURITY: /_studio AND /__nuxt_studio/* must be gated by Cloudflare Access on this
  // hostname. /__nuxt_studio/ipx/** is a server-side proxy (SSRF) if left public.
  // Do NOT gate /__nuxt_content/* (the public runtime content API) or the site pages.
  studio: {
    route: '/_studio',
    repository: {
      provider: 'github',
      owner: 'debloisg',
      repo: 'ptank',
      branch: 'main',
    },
    // Media uploaded in Studio goes to R2 (via NuxtHub blob, below) instead of
    // being committed to Git — so editor uploads never bloat the repo or the
    // deploy bundle. `publicUrl` (S3_PUBLIC_URL = the bucket's public domain)
    // is how the uploaded files are then served/referenced.
    media: {
      external: true,
      // Browse AND upload the same `images/` prefix the site already serves from,
      // so the Media tab lists the curated images pushed to R2 by
      // scripts/upload-images-to-r2.sh, and new Studio uploads land beside them.
      // nuxt-studio defaults this to "studio/" (module.mjs) — an empty prefix here,
      // which is why the Media tab showed nothing despite R2 being full.
      prefix: 'images',
      // Same bucket as images — defaults to r2Base (one bucket, images/ prefix).
      publicUrl: (process.env.S3_PUBLIC_URL || r2Base).trim().replace(/\/+$/, ''),
      // Studio uploads whatever the editor picked, untouched (upstream
      // nuxt-content/nuxt-studio#348). app/plugins/studio-media-resize.client.ts
      // downscales in the browser first; these two are the backstop it can't
      // bypass. 5 MB fits any phone JPEG that survived the resize — bigger means
      // the resize was skipped, e.g. a raw dump.
      maxFileSize: 5 * 1024 * 1024,
      // Narrower than the default ['image/*', 'video/*', 'audio/*']. HEIC passes
      // `image/*` but neither Chrome nor Cloudflare Image Transformations can
      // decode it — it would upload full-size and then render broken. Video and
      // audio can't be transformed either, so they'd stream raw out of R2.
      allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
    },
  },

  // NuxtHub blob = the R2 storage Studio uploads land in. Native `cloudflare-r2`
  // driver on binding `BLOB` (mapped to the `ptank-images` bucket in
  // wrangler.jsonc). Only blob is enabled — content's D1 (`DB`) is untouched.
  hub: {
    blob: true,
    // NOTE: `remote: 'production'` used to sit here to point `nuxt dev` at the
    // deployed R2 (so Studio's media tab worked locally). @nuxthub/core 0.10
    // dropped that option along with NuxtHub's hosted platform, so it was dead
    // config — typecheck flagged it as unknown. Removed. Studio media listing in
    // dev now needs a real BLOB binding (`wrangler dev`) instead;
    // NUXT_HUB_PROJECT_URL / NUXT_HUB_PROJECT_SECRET_KEY in .env are likewise
    // no longer read by anything.
  },

  app: {
    head: {
      htmlAttrs: { lang: 'fr' },
      title: 'Pétanque Fouesnantaise',
      // Pages already brand their own titles (e.g. "X · Pétanque
      // Fouesnantaise"), so use the title verbatim. Without this, @nuxtjs/seo
      // would append the site name a second time ("… | Pétanque Fouesnantaise").
      titleTemplate: '%s',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content:
            'Club de pétanque à Fouesnant (29) — actualités, événements, compétitions, résultats et adhésion.',
        },
        // Social sharing. twitter:card was already `summary_large_image`, which
        // PROMISES an image — with none set, every share (Facebook, WhatsApp,
        // Slack, Discord) rendered a blank card. Individual pages override
        // og:image when they have their own photo (see pages/[...slug].vue).
        { property: 'og:image', content: ogImage },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { property: 'og:image:alt', content: 'Terrain de pétanque du club à Fouesnant' },
        { property: 'og:locale', content: 'fr_FR' },
        { name: 'twitter:image', content: ogImage },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
      // Analytics beacon, only when a token is configured (see cfBeaconToken
      // above). `defer` keeps it off the critical path so it can't affect LCP.
      script: cfBeaconToken
        ? [
            {
              src: `${CF_INSIGHTS}/beacon.min.js`,
              defer: true,
              'data-cf-beacon': JSON.stringify({ token: cfBeaconToken }),
            },
          ]
        : [],
    },
  },
})
