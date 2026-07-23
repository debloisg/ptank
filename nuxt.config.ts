// https://nuxt.com/docs/api/configuration/nuxt-config

// Dev serves images straight from /public; prod resizes them through
// Cloudflare Image Transformations, pulling the originals from R2. See the
// `image` block below and the "Images" section of the README.
const isDev = process.env.NODE_ENV !== 'production'
// Public domain of the R2 bucket that holds /images/** (e.g.
// https://img.petanque-fouesnantaise.fr, or a pub-xxx.r2.dev dev URL).
// Falls back to the bucket's r2.dev domain so the Cloudflare Workers build (and
// dev) render images without a build-time env var — the deploy has no image
// originals bundled, so an empty base = broken images. Override with
// NUXT_IMAGE_R2_BASE (a custom img.<site> domain) to unlock transforms.
const r2Base = process.env.NUXT_IMAGE_R2_BASE || 'https://pub-6d40831c9da84a2a900724d5a4e2c0dd.r2.dev'
// Cloudflare Image Transformations only resize sources on the SAME zone as the
// site (subdomains OK). The shared r2.dev domain is off-zone, so it can't be
// transformed — serve originals as-is from it. Point NUXT_IMAGE_R2_BASE at a
// custom domain on your zone (e.g. img.<site>) to unlock resizing/WebP/AVIF.
const canTransform = !!r2Base && !/\.r2\.dev(?:\/|$)/.test(r2Base)

export default defineNuxtConfig({
  // @nuxthub/core must come BEFORE nuxt-studio (Studio detects its blob
  // storage to enable external media uploads → R2). @nuxt/image is before
  // @nuxt/ui so Nuxt UI renders <UBlogPost>/<ProseImg>/etc. through NuxtImg.
  // @nuxtjs/seo = sitemap + robots + schema.org + canonical/OG meta.
  // nuxt-a11y runs axe-core in the dev console only (no prod overhead).
  modules: ['@nuxthub/core', '@nuxt/image', '@nuxt/content', '@nuxt/ui', '@nuxtjs/seo', 'nuxt-a11y', 'nuxt-studio'],
  css: ['~/assets/css/main.css'],
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
  // includes Transformations) returns a resized WebP/AVIF. On an r2.dev URL —
  // or in dev — it falls back to `none`, serving the originals untouched.
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
  // Set NUXT_PUBLIC_SITE_URL to the real production URL (placeholder below).
  site: {
    url: process.env.NUXT_PUBLIC_SITE_URL || 'https://www.petanque-fouesnantaise.fr',
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
      // Same bucket as images — defaults to r2Base (one bucket, studio/ prefix).
      publicUrl: process.env.S3_PUBLIC_URL || r2Base,
    },
  },

  // NuxtHub blob = the R2 storage Studio uploads land in. Native `cloudflare-r2`
  // driver on binding `BLOB` (mapped to the `ptank-images` bucket in
  // wrangler.jsonc). Only blob is enabled — content's D1 (`DB`) is untouched.
  hub: {
    blob: true,
    // Connect dev (`nuxt dev`) to the deployed production R2 so Studio media
    // listing/preview works locally — plain dev has no BLOB binding. Only
    // affects dev/preview; the deployed worker always uses its real bindings.
    // Requires NUXT_HUB_PROJECT_URL + NUXT_HUB_PROJECT_SECRET_KEY (see .env),
    // and the same secret set on the deployed worker.
    remote: 'production',
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
      link: [{ rel: 'icon', href: '/favicon.ico' }],
    },
  },
})
