// https://nuxt.com/docs/api/configuration/nuxt-config

// Dev serves images straight from /public; prod resizes them through
// Cloudflare Image Transformations, pulling the originals from R2. See the
// `image` block below and the "Images" section of the README.
const isDev = process.env.NODE_ENV !== 'production'
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
// Cloudflare Image Transformations only resize sources on the SAME zone as the
// site (subdomains OK). A shared r2.dev domain is off-zone, so it can't be
// transformed — originals are then served as-is. image.petanque-fouesnantaise.fr
// is on-zone, so resizing/WebP/AVIF is available.
const canTransform = !!r2Base && !/\.r2\.dev(?:\/|$)/.test(r2Base)

// ── Content-Security-Policy ────────────────────────────────────────────────
// Two policies: a strict one for the public site, a relaxed one for the Studio
// editor. Both are still REPORT-ONLY (see the routeRules below) — the values
// here were derived from the violations the first report-only pass logged.
//
// `script-src` keeps 'unsafe-inline' because the pages are prerendered static
// HTML: there is no per-request step in which to mint a nonce, and Nuxt inlines
// its hydration payload. That's the remaining weak point of this policy.
const cspBase = [
  "default-src 'self'",
  // data: covers the inlined blur placeholders @nuxt/image generates.
  `img-src 'self' data: ${r2Base}`,
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

// Non-CSP security headers, identical on every route.
const securityHeaders = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
}

const publicCsp = [
  ...cspBase,
  "script-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${ICONIFY}`,
].join('; ')

const studioCsp = [
  ...cspBase,
  // 'unsafe-eval' + 'wasm-unsafe-eval': the editor evaluates strings and
  // instantiates WebAssembly. worker-src: it registers /sw.js.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  `connect-src 'self' ${ICONIFY}`,
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
      // CSP is REPORT-ONLY on purpose: Nuxt hydration inlines scripts/styles
      // and Studio's editor loads its own assets, so enforcing a strict policy
      // blind would break the site. Watch the browser console for violation
      // reports, then tighten and switch to `content-security-policy`.
      '/**': {
        headers: { ...securityHeaders, 'content-security-policy-report-only': publicCsp },
      },
      // Studio's editor legitimately needs what the public site must never have:
      // eval() and WebAssembly (its markdown/tiptap tooling), plus a service
      // worker. Rather than weaken the whole site to accommodate the CMS, relax
      // the policy only on these paths — which Cloudflare Access already gates,
      // so only signed-in editors can reach them.
      // Each rule repeats the full header set on purpose: a browser that receives
      // TWO CSPs enforces the INTERSECTION of them, so a leftover strict policy
      // alongside the relaxed one would still block Studio's eval once these are
      // enforced rather than report-only.
      '/_studio/**': {
        headers: { ...securityHeaders, 'content-security-policy-report-only': studioCsp },
      },
      '/__nuxt_studio/**': {
        headers: { ...securityHeaders, 'content-security-policy-report-only': studioCsp },
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

  // ── Images (R2 + Cloudflare Image Transformations) ──────────────────────
  // The image originals live in R2, NOT in /public — they are never copied
  // into the deploy bundle (source files are kept in /image-sources purely to
  // upload from; see scripts/upload-images-to-r2.sh). NUXT_IMAGE_R2_BASE (the
  // bucket's public domain) is therefore required to see images anywhere,
  // dev included — set it in .env locally.
  //
  // `alias` rewrites the /images/** paths used in content + components to the
  // R2 bucket. When the bucket is on your zone (custom domain), the `cloudflare`
  // provider wraps them in /cdn-cgi/image/<opts>/… so the edge (free tier
  // includes Transformations) returns a resized WebP/AVIF. On an off-zone
  // r2.dev URL — or in dev — it falls back to `none`, serving originals untouched.
  // NuxtImg adds lazy loading + srcset either way; the blur placeholder needs
  // the resizing provider, so it only appears once you're on a custom domain.
  image: {
    provider: canTransform && !isDev ? 'cloudflare' : 'none',
    // baseURL '/' → transforms resolve on the deployed Worker's own origin,
    // so the production domain never has to be hardcoded here.
    cloudflare: { baseURL: '/' },
    ...(r2Base ? { alias: { '/images': `${r2Base}/images` } } : {}),
    quality: 75,
  },

  // ── SEO (@nuxtjs/seo) ───────────────────────────────────────────────────
  // Drives sitemap.xml, robots.txt, schema.org JSON-LD and canonical/OG tags.
  // Defaults to the live apex domain; NUXT_PUBLIC_SITE_URL can override it
  // (e.g. a preview deployment).
  site: {
    url: (process.env.NUXT_PUBLIC_SITE_URL || 'https://petanque-fouesnantaise.fr').trim(),
    name: 'La Pétanque Fouesnantaise',
    description:
      'Club de pétanque à Fouesnant (29) — actualités, événements, compétitions, résultats et adhésion.',
    defaultLocale: 'fr',
  },
  // Dynamic OG image rendering (satori wasm) would push the Worker past the
  // Cloudflare free-tier size limit — disabled. Static og:image tags still work.
  ogImage: { enabled: false },

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
      title: 'La Pétanque Fouesnantaise',
      // Pages already brand their own titles (e.g. "X · La Pétanque
      // Fouesnantaise"), so use the title verbatim. Without this, @nuxtjs/seo
      // would append the site name a second time ("… | La Pétanque Fouesnantaise").
      titleTemplate: '%s',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content:
            'Club de pétanque à Fouesnant (29) — actualités, événements, compétitions, résultats et adhésion.',
        },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
})
