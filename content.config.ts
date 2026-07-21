import { defineContentConfig, defineCollection, z } from '@nuxt/content'

// One collection per content type so Nuxt Studio shows a clean, relevant form
// for each file instead of one kitchen-sink schema. `type: 'page'` collections
// automatically expose title/description/body; the schemas below add the extra
// editable fields. `.editor()` tailors the Studio widget (media/icon pickers,
// labelled enum dropdowns, French labels + help text).

// ── Reusable field builders (fresh instance per call so metadata never leaks) ──
const dateField = () =>
  z.string().optional().editor({ label: 'Date', description: 'Format AAAA-MM-JJ (ex : 2026-08-10)' })
const imageField = () =>
  z.string().optional().editor({ input: 'media', label: 'Image' })
const categoryField = () =>
  z.string().optional().editor({ label: 'Catégorie', description: 'Ex : Officiel FFPJP, Doublette, Ouvert à tous' })
const locationField = () =>
  z.string().optional().editor({ label: 'Lieu', description: 'Ex : Boulodrome de Bréhoulou' })

const linkField = () =>
  z.object({
    label: z.string().editor({ label: 'Texte du bouton' }),
    to: z.string().editor({ label: 'Lien', description: 'URL ou chemin interne (ex : /contact)' }),
    icon: z.string().optional().editor({ input: 'icon', label: 'Icône' }),
  })

// Dated post schema shared by news / events / competitions / results.
const postSchema = (opts: { location?: boolean } = {}) =>
  z.object({
    date: dateField(),
    image: imageField(),
    category: categoryField(),
    ...(opts.location ? { location: locationField() } : {}),
  })

export default defineContentConfig({
  collections: {
    // ── Homepage (singleton) ───────────────────────────────────────────────
    home: defineCollection({
      type: 'page',
      source: 'index.md',
      schema: z.object({
        heroStyle: z
          .enum(['photo', 'native'])
          .optional()
          .editor({
            label: 'Style du hero',
            description: 'photo = grande image plein écran (défaut) · native = hero Nuxt UI (texte + image à côté)',
          }),
        eyebrow: z.string().optional().editor({ label: 'Sur-titre', description: 'Petit texte au-dessus du titre' }),
        tagline: z.string().optional().editor({ label: 'Accroche', description: 'Sous-titre court sous le grand titre' }),
        image: imageField(), // hero background photo
        links: z.array(linkField()).optional().editor({ label: 'Boutons du hero' }),
        cta: z
          .object({
            title: z.string().editor({ label: 'Titre' }),
            description: z.string().optional().editor({ label: 'Description' }),
          })
          .optional()
          .editor({ label: "Bloc d'appel à l'action (bas de page)" }),
        stats: z
          .array(z.object({
            value: z.string().editor({ label: 'Valeur' }),
            label: z.string().editor({ label: 'Libellé' }),
          }))
          .optional()
          .editor({ label: 'Chiffres clés' }),
        highlights: z
          .array(z.object({
            icon: z.string().optional().editor({ input: 'icon', label: 'Icône' }),
            title: z.string().editor({ label: 'Titre' }),
            description: z.string().editor({ label: 'Description' }),
          }))
          .optional()
          .editor({ label: 'Points forts' }),
        partners: z
          .array(z.object({
            name: z.string().editor({ label: 'Nom' }),
            logo: z.string().editor({ input: 'media', label: 'Logo' }),
            href: z.string().optional().editor({ label: 'Site web' }),
          }))
          .optional()
          .editor({ label: 'Partenaires' }),
      }),
    }),

    // ── Section landing configs: /actualites, /evenements, … (header + display) ──
    sections: defineCollection({
      type: 'page',
      source: { include: '{actualites,evenements,competitions,resultats}.md' },
      schema: z.object({
        eyebrow: z.string().optional().editor({ label: 'Sur-titre' }),
        orientation: z
          .enum(['horizontal', 'vertical'])
          .optional()
          .editor({
            label: 'Disposition de la liste',
            description: 'horizontal = grille de cartes · vertical = liste pleine largeur (idéale avec des images)',
          }),
      }),
    }),

    // ── Standalone pages: a-propos, contact ─────────────────────────────────
    pages: defineCollection({
      type: 'page',
      source: {
        include: '*.md',
        exclude: ['index.md', 'actualites.md', 'evenements.md', 'competitions.md', 'resultats.md'],
      },
      schema: z.object({
        image: imageField(),
      }),
    }),

    // ── Dated content ───────────────────────────────────────────────────────
    news: defineCollection({ type: 'page', source: 'actualites/**', schema: postSchema() }),
    events: defineCollection({ type: 'page', source: 'evenements/**', schema: postSchema({ location: true }) }),
    competitions: defineCollection({ type: 'page', source: 'competitions/**', schema: postSchema({ location: true }) }),
    results: defineCollection({ type: 'page', source: 'resultats/**', schema: postSchema({ location: true }) }),
  },
})
