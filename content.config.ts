import { defineContentConfig, defineCollection, z } from '@nuxt/content'

// One collection for every page and post. The optional fields drive the
// auto-generated forms non-coders fill in inside Nuxt Studio. All fields are
// optional so a plain page, a dated post and the homepage can share it.
export default defineContentConfig({
  collections: {
    content: defineCollection({
      type: 'page',
      source: '**',
      schema: z.object({
        // Posts (actualités, événements, compétitions, résultats)
        date: z.string().optional(), // format AAAA-MM-JJ, ex: 2026-08-10
        image: z.string().optional(), // ex: /images/concours.jpg
        location: z.string().optional(), // ex: Boulodrome de Bréhoulou
        category: z.string().optional(), // ex: Officiel FFPJP, Doublette, Club

        // Listing pages (ex: content/actualites.md) — how the post list renders.
        // `.editor()` turns the enum into a labelled dropdown inside Nuxt Studio.
        orientation: z
          .enum(['horizontal', 'vertical'])
          .optional()
          .editor({
            label: 'Disposition de la liste',
            description:
              'horizontal = grille de cartes · vertical = liste pleine largeur (idéale avec des images)',
          }),

        // Homepage hero (content/index.md)
        eyebrow: z.string().optional(), // ex: Depuis 1978 · Fouesnant, Finistère
        tagline: z.string().optional(), // sous-titre court sous le grand titre
        stats: z
          .array(z.object({ value: z.string(), label: z.string() }))
          .optional(),
        highlights: z
          .array(z.object({ title: z.string(), description: z.string() }))
          .optional(),
        partners: z
          .array(z.object({
            name: z.string(),
            logo: z.string(), // ex: /images/partenaires/agence-du-steir.jpg
            href: z.string().optional(),
          }))
          .optional(),
      }),
    }),
  },
})
