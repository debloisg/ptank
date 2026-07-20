// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/content', '@nuxt/ui', 'nuxt-studio'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  // Recent date so Nitro selects the modern `cloudflare_module` preset
  // (nodejs_compat) instead of `cloudflare-module-legacy`, whose polyfill
  // injection fails to parse unhead's iife bundle. Matches wrangler.jsonc.
  compatibilityDate: '2026-07-20',

  // Cloudflare Workers (with static assets) deploy target.
  // Hybrid rendering: every page is prerendered to static HTML, and only
  // Studio's server routes (/_studio, /__nuxt_studio/*) run as edge functions.
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

  // Nuxt Studio — the in-browser CMS non-coders use to edit content.
  // Floating editor lives at /_studio once the site is deployed with SSR.
  studio: {
    route: '/_studio',
    repository: {
      provider: 'github',
      owner: 'debloisg',
      repo: 'ptank',
      branch: 'main',
    },
  },

  app: {
    head: {
      htmlAttrs: { lang: 'fr' },
      title: 'La Pétanque Fouesnantaise',
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
