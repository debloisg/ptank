// Shared types and helpers for the archive photo gallery.
//
// Photo dates come out of the importer at three different precisions and three
// different confidence levels (see `dateSource`), so formatting them is not a
// one-liner: a photo dated from its file path is a guess at the year, while one
// dated from EXIF is exact to the day. The UI must not present those identically.

export interface GalleryPhotoArticle {
  path: string
  title: string
  date?: string
}

export interface GalleryPhoto {
  src: string
  w: number
  h: number
  alt: string
  /** `YYYY`, `YYYY-MM` or `YYYY-MM-DD` — partial dates are normal. */
  date?: string
  dateSource?: 'exif' | 'article' | 'path'
  title?: string
  description?: string
  articles?: GalleryPhotoArticle[]
}

/** A photo plus its position in the album's flat, chronologically sorted list. */
export interface IndexedGalleryPhoto extends GalleryPhoto {
  index: number
}

const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? ''
}

/**
 * French label for a photo date, honest about precision and confidence.
 * `2016-05-14` → "14 mai 2016" · `2016-05` → "mai 2016" · `2016` → "2016".
 * A path-derived date is prefixed with "vers" (circa), because it was inferred
 * from a folder or file name rather than read from the image or an article.
 */
export function formatPhotoDate(photo: Pick<GalleryPhoto, 'date' | 'dateSource'>): string | null {
  if (!photo.date) return null
  const [year, month, day] = photo.date.split('-')
  if (!year) return null

  let label: string
  if (day && month) label = `${Number(day)} ${monthName(Number(month))} ${year}`
  else if (month) label = `${monthName(Number(month))} ${year}`
  else label = year

  return photo.dateSource === 'path' ? `vers ${label}` : label
}

/**
 * Album-level date span, as years. `dateRange` holds full photo dates
 * (`2009-10-03`), but an album covering a decade should read "2009–2026", not
 * "2009-10-03–2026" — the day the earliest surviving photo was taken is noise at
 * album granularity. Falls back to the years merely inferred from folder names.
 */
export function formatAlbumSpan(album: {
  years?: number[]
  dateRange?: { from: string, to: string }
}): string | null {
  const range = album.dateRange
  if (range) {
    const from = range.from.slice(0, 4)
    const to = range.to.slice(0, 4)
    return from === to ? from : `${from}–${to}`
  }
  const years = album.years ?? []
  if (!years.length) return null
  return years.length === 1 ? String(years[0]) : `${years[0]}–${years.at(-1)}`
}

/**
 * Stable DOM id for a photo, derived from its filename. Filenames are already
 * slugified by the importer (lowercase, `[a-z0-9._-]`) and unique within an album,
 * so this needs no extra escaping.
 */
export function photoDomId(src: string): string {
  const base = src.split('/').pop() ?? src
  return `photo-${base.replace(/\.[^.]+$/, '')}`
}

/**
 * Works out which photos a URL fragment refers to. Two accepted forms:
 *
 *   `#annee-2013`        — every photo dated to that year. This is what the
 *                          /archives feed links to, because one album-year row can
 *                          cover 30+ photos and spelling them all out would make a
 *                          several-hundred-character URL.
 *   `#photo-a,photo-b`   — specific photos by id, for deep-linking one shot. The
 *                          `photo-` prefix is optional on each entry.
 *
 * Returns the matching `src`s in ALBUM order (not fragment order), so the page
 * scrolls to whichever comes first on screen.
 */
export function resolvePhotoHash(hash: string, photos: GalleryPhoto[]): string[] {
  let raw = hash.replace(/^#/, '').trim()
  try {
    raw = decodeURIComponent(raw)
  }
  catch {
    // A malformed percent-escape must not take the page down; fall back to the raw
    // fragment, which simply won't match anything.
  }
  if (!raw) return []

  const year = raw.match(/^annee-(\d{4})$/)
  if (year) return photos.filter(p => p.date?.startsWith(year[1]!)).map(p => p.src)

  const wanted = new Set(
    raw
      .split(',')
      .map(part => part.trim().replace(/^photo-/, ''))
      .filter(Boolean),
  )
  if (!wanted.size) return []
  return photos
    .filter(p => wanted.has(photoDomId(p.src).replace(/^photo-/, '')))
    .map(p => p.src)
}
