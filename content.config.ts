import { defineContentConfig, defineCollection, z } from '@nuxt/content'
import { defineSitemapSchema } from '@nuxtjs/sitemap/content'

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
// Emits <lastmod> in sitemap.xml from each entry's frontmatter `date`, so crawlers
// can see which pages actually changed instead of re-crawling everything. Editors
// never fill this in — it derives from the date they already set on the post.
// `name` must match the collection: the module keys its onUrl callbacks by
// collection name, and errors out without it.
const sitemapField = (name: string) =>
  defineSitemapSchema({
    name,
    // Arrow function on purpose: the module serialises this callback with
    // Function.prototype.toString() into a virtual module, and shorthand method
    // syntax ("onUrl(url, entry) {…}") is not valid there.
    onUrl: (url, entry) => {
      if (entry?.date) url.lastmod = new Date(entry.date as string)
    },
  })
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
const postSchema = (opts: { name: string, location?: boolean }) =>
  z.object({
    date: dateField(),
    image: imageField(),
    category: categoryField(),
    sitemap: sitemapField(opts.name),
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
      source: { include: '{actualites,evenements,competitions,resultats,archives}.md' },
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
        exclude: ['index.md', 'actualites.md', 'evenements.md', 'competitions.md', 'resultats.md', 'archives.md'],
      },
      schema: z.object({
        image: imageField(),
      }),
    }),

    // ── Dated content ───────────────────────────────────────────────────────
    // ── Archives (imported, read-only in practice) ──────────────────────────
    // The 244 articles recovered from the old Joomla site (2008-2026), converted
    // by scripts/import-archives.mjs. Its own collection rather than a dump into
    // `news`: it carries import-only metadata (joomlaId, hits, journal period),
    // and mixing 244 historical entries into /actualites would bury the four
    // current ones. Editors can still fix a typo in Studio; nothing here is
    // meant to be authored from scratch.
    archives: defineCollection({
      type: 'page',
      source: 'archives/**',
      schema: z.object({
        date: dateField(),
        // Duplicates the folder name, but as a real field it can be filtered and
        // ordered on in D1 without parsing paths in every query.
        year: z.number().editor({ label: 'Année' }),
        category: categoryField(),
        image: imageField(),
        // Set only on the monthly "Journal du club" issues: the period the issue
        // covers, as YYYY-MM. Absent on one-off articles.
        journal: z
          .string()
          .optional()
          .editor({ label: 'Numéro de journal', description: 'Période couverte, au format AAAA-MM' }),
        // Provenance from the Joomla export — kept so an imported page can always
        // be traced back to its row in the old CMS.
        joomlaId: z.number().optional().editor({ label: 'Identifiant Joomla (origine)' }),
        hits: z.number().optional().editor({ label: 'Vues sur l’ancien site' }),
        sitemap: sitemapField('archives'),
      }),
    }),

    // ── Photo gallery albums (data collection, generated) ───────────────────
    // One JSON file per album, emitted by scripts/generate-galerie-content.mjs
    // from the photo import. A `data` collection (not `page`) because albums have
    // no prose body — and because it lets /archives/galerie `.select()` only the
    // album metadata instead of shipping all 1355 photo records to the browser.
    galerie: defineCollection({
      type: 'data',
      source: 'galerie/**.json',
      schema: z.object({
        key: z.string(),
        title: z.string(),
        // `documents` = scans, posters, club emblems; `photos` = actual
        // photographs. The gallery leads with photo albums and groups the rest.
        kind: z.enum(['photos', 'documents']),
        count: z.number(),
        // Years inferred from the source paths, ascending. Often empty — the
        // importer only records a year it could establish with confidence.
        years: z.array(z.number()),
        // Earliest/latest dated photo in the album. Absent when no photo in the
        // album could be dated at all.
        dateRange: z
          .object({ from: z.string(), to: z.string() })
          .optional(),
        // Per-year aggregates keyed by "YYYY", precomputed by
        // scripts/generate-galerie-content.mjs. They exist so /archives can build
        // its timeline of articles + albums while selecting only album metadata —
        // pulling all 1355 photo records into that page would be ~150 KB.
        // `from`/`to` are the album's date span WITHIN that year, which is what
        // lets an album sort in among the articles at month precision.
        byYear: z.record(
          z.string(),
          z.object({
            count: z.number(),
            from: z.string(),
            to: z.string(),
            thumbs: z.array(z.object({ src: z.string(), w: z.number(), h: z.number(), alt: z.string() })),
          }),
        ),
        cover: z.string(),
        photos: z.array(
          z.object({
            src: z.string(),
            // Intrinsic dimensions of the downscaled file, so the grid can
            // reserve the right box and avoid layout shift while images decode.
            w: z.number(),
            h: z.number(),
            alt: z.string(),
            // Partial dates are normal and meaningful here: "2016" means the
            // year is all the importer could establish. Hence a string, not a
            // date — "2016-03" is not a valid Date.
            date: z.string().optional().editor({ label: 'Date' }),
            // How `date` was established: EXIF metadata (trustworthy to the
            // day), the article the photo appears in, or a year parsed out of
            // the file path (weakest). Lets the UI hedge its wording.
            dateSource: z.enum(['exif', 'article', 'path']).optional(),
            // Both optional and usually empty: the Joomla dump carries no
            // captions. They exist so an editor can add them in Studio, and are
            // only rendered when present.
            title: z.string().optional().editor({ label: 'Titre' }),
            description: z
              .string()
              .optional()
              .editor({ label: 'Légende', description: 'Texte affiché au survol et dans la visionneuse' }),
            // Archive articles that use this exact image, matched by SHA-256 of
            // the original bytes (not by filename). Usually absent.
            articles: z
              .array(z.object({
                path: z.string(),
                title: z.string(),
                date: z.string().optional(),
              }))
              .optional(),
          }),
        ),
      }),
    }),

    news: defineCollection({ type: 'page', source: 'actualites/**', schema: postSchema({ name: 'news' }) }),
    events: defineCollection({ type: 'page', source: 'evenements/**', schema: postSchema({ name: 'events', location: true }) }),
    competitions: defineCollection({ type: 'page', source: 'competitions/**', schema: postSchema({ name: 'competitions', location: true }) }),
    results: defineCollection({ type: 'page', source: 'resultats/**', schema: postSchema({ name: 'results', location: true }) }),
  },
})
