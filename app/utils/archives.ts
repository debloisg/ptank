// Builds the /archives chronological feed: ONE flat, date-sorted stream mixing
// every kind of archived thing — club journals, competition write-ups, calendars,
// photo albums — newest first, each carrying its own icon.
//
// Flat rather than years-as-containers on purpose: the archive reads as a single
// history, and nesting a year's contents inside a collapsible block hides exactly
// the interleaving that makes it interesting (a competition write-up sitting next
// to the album of photos from that same weekend).

import type { GalleryPhoto } from '~/utils/gallery'

export interface FeedArticle {
  path: string
  title?: string
  year?: number
  category?: string
  date?: string
  journal?: string
  description?: string
  /** The article's hero image, shown as the row's thumbnail when it has one. */
  image?: string
}

export interface AlbumYearEntry {
  count: number
  from: string
  to: string
  thumbs: Array<{ src: string, w: number, h: number, alt: string }>
}

export interface FeedAlbumSource {
  key: string
  title: string
  kind: 'photos' | 'documents'
  count: number
  byYear: Record<string, AlbumYearEntry>
}

export type ArchiveEventType = 'journal' | 'competition' | 'calendar' | 'club' | 'flash' | 'article' | 'album' | 'documents'

export interface ArchiveEvent {
  /** Stable key for :key / UTimeline `value`. */
  id: string
  type: ArchiveEventType
  title: string
  to: string
  icon: string
  /** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. */
  date?: string
  year: number
  /** Sortable, zero-padded date used for ordering. */
  sortKey: string
  category?: string
  /** Articles only: the frontmatter summary, shown under the card title. */
  description?: string
  /** Articles only: the hero image, if the article has one. */
  image?: string
  /** Albums only. */
  photoCount?: number
  /**
   * Albums only. Derived from the same catalogue records as the gallery, so the
   * shape is picked from GalleryPhoto rather than restated.
   */
  thumbs?: Array<Pick<GalleryPhoto, 'src' | 'w' | 'h' | 'alt'>>
}

// A distinct icon per kind of thing, matched against the imported Joomla
// categories. These strings are the real category values in the corpus — see
// content/archives/**/*.md frontmatter.
const CATEGORY_ICONS: Array<{ test: RegExp, type: ArchiveEventType, icon: string }> = [
  { test: /journal/i, type: 'journal', icon: 'i-lucide-newspaper' },
  { test: /championnat|comp[ée]tition|coupe|troph[ée]e|gentlemen/i, type: 'competition', icon: 'i-lucide-trophy' },
  { test: /calendrier/i, type: 'calendar', icon: 'i-lucide-calendar-days' },
  { test: /flash/i, type: 'flash', icon: 'i-lucide-zap' },
  { test: /album/i, type: 'album', icon: 'i-lucide-images' },
  { test: /r[èe]glement/i, type: 'article', icon: 'i-lucide-scale' },
  { test: /club|bureau|licenci/i, type: 'club', icon: 'i-lucide-users' },
  { test: /f[êe]te|pommiers|rassemblement/i, type: 'club', icon: 'i-lucide-party-popper' },
]

function classifyArticle(article: FeedArticle): { type: ArchiveEventType, icon: string } {
  // The monthly journal is identified by its `journal` period, not its category —
  // that field is the reliable signal (the categories are inconsistent).
  if (article.journal) return { type: 'journal', icon: 'i-lucide-newspaper' }
  const haystack = `${article.category ?? ''} ${article.title ?? ''}`
  for (const { test, type, icon } of CATEGORY_ICONS) {
    if (test.test(haystack)) return { type, icon }
  }
  return { type: 'article', icon: 'i-lucide-file-text' }
}

/**
 * Zero-pads a partial date so `2016`, `2016-03` and `2016-03-04` sort correctly
 * against each other. Year-only sorts to the START of its year, which keeps a
 * vaguely-dated item from jumping ahead of precisely-dated ones.
 */
function sortKeyFor(date: string | undefined, year: number): string {
  if (!date) return `${year}-00-00`
  const [y, m = '00', d = '00'] = date.split('-')
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

/**
 * The article's real date. The Joomla `created` timestamp is unreliable — 6 dates
 * are bulk-import artefacts shared by up to 37 articles — so a journal's own
 * `journal` period wins when present.
 */
function articleDate(article: FeedArticle): string | undefined {
  if (article.journal) {
    const [year, month] = article.journal.split('-')
    return month ? `${year}-${month.padStart(2, '0')}` : year
  }
  return article.date
}

/** One flat stream, newest first. */
export function buildArchiveFeed(
  articles: FeedArticle[],
  albums: FeedAlbumSource[],
): ArchiveEvent[] {
  const events: ArchiveEvent[] = []

  for (const article of articles) {
    const date = articleDate(article)
    const year = article.year ?? Number(date?.slice(0, 4))
    if (!Number.isFinite(year)) continue
    const { type, icon } = classifyArticle(article)
    events.push({
      id: `article:${article.path}`,
      type,
      title: article.title ?? article.path,
      to: article.path,
      icon,
      date,
      year,
      sortKey: sortKeyFor(date, year),
      category: article.category,
      description: article.description,
      image: article.image,
    })
  }

  for (const album of albums) {
    for (const [yearKey, entry] of Object.entries(album.byYear ?? {})) {
      const year = Number(yearKey)
      if (!Number.isFinite(year) || entry.count <= 0) continue
      events.push({
        id: `album:${album.key}:${yearKey}`,
        type: album.kind === 'documents' ? 'documents' : 'album',
        title: album.title,
        // The `#annee-YYYY` fragment tells the album page which photos this row
        // stands for, so it can scroll to them and flash them. A year is used
        // rather than a list of photo ids because one row can cover 30+ photos —
        // see resolvePhotoHash().
        to: `/archives/galerie/${album.key}#annee-${yearKey}`,
        icon: album.kind === 'documents' ? 'i-lucide-file-stack' : 'i-lucide-images',
        date: entry.from,
        year,
        sortKey: sortKeyFor(entry.from, year),
        photoCount: entry.count,
        thumbs: entry.thumbs,
      })
    }
  }

  // Newest first. Ties broken by title so the order is stable across renders
  // (many items share a year-only date).
  return events.sort(
    (a, b) => b.sortKey.localeCompare(a.sortKey) || a.title.localeCompare(b.title, 'fr'),
  )
}

const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

/** Short French label for a feed event's date, honest about its precision. */
export function formatEventDate(event: Pick<ArchiveEvent, 'date' | 'year'>): string {
  if (!event.date) return String(event.year)
  const [year, month, day] = event.date.split('-')
  const monthName = month ? MONTHS[Number(month) - 1] : undefined
  if (day && monthName) return `${Number(day)} ${monthName} ${year}`
  if (monthName) return `${monthName} ${year}`
  return year ?? String(event.year)
}
