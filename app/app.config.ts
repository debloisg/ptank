// Global Nuxt UI theme — every semantic color used in the app resolves through
// this map, so component `color` props stay in sync with the brand palette.
// - primary  = marine (deep navy ink)      → defined in assets/css/main.css
// - secondary = clay (terracotta accent)   → defined in assets/css/main.css
// - success  = sage (muted olive green)    → defined in assets/css/main.css
// - neutral  = stone (warm greys)
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'marine',
      secondary: 'clay',
      success: 'sage',
      neutral: 'stone',
    },
    // Nuxt UI's <UBlogPost> handles the card grid, image aspect ratio, hover and
    // date formatting. We graft the editorial brand card on top so posts match
    // the stats / agenda cards elsewhere: solid cream surface, soft border,
    // lift-on-hover. `!` overrides the variant's translucent bg + ring.
    blogPost: {
      slots: {
        root: 'rounded-2xl border border-default !bg-elevated !ring-0 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-accented hover:!bg-elevated',
        title: 'font-serif transition-colors group-hover/blog-post:text-primary',
      },
    },
    // Serif titles + clay eyebrow on the native hero (heroStyle: native).
    pageHero: {
      slots: {
        title: 'font-serif font-semibold',
        headline: 'text-secondary uppercase tracking-[0.16em] text-sm font-semibold',
      },
    },
    // Highlight cards → brand card (solid cream, soft border, serif title).
    // `!` overrides the outline variant's bg-default + ring.
    pageCard: {
      slots: {
        root: 'rounded-2xl border border-default !bg-elevated !ring-0 shadow-sm',
        title: 'font-serif text-xl',
      },
    },
    // CTA band uses the solid (navy) variant; just make its title serif.
    pageCTA: {
      slots: {
        title: 'font-serif font-semibold',
      },
    },
  },
})
