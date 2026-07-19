// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/content', '@nuxt/ui', 'nuxt-studio'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  compatibilityDate: '2024-04-03',

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
