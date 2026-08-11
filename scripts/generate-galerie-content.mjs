// Turns the archive photo catalogue (.archive-import/galerie.json, produced by
// scripts/import-archive-photos.mjs) into one committed JSON file per album under
// content/galerie/, so the gallery becomes a normal @nuxt/content `data`
// collection instead of a build-time import.
//
// Why a content collection rather than importing galerie.json in a page:
//   - .archive-import/ is gitignored (it holds ~330 MB of Joomla-era originals),
//     so nothing there can be read at build time on Cloudflare. The catalogue has
//     to be committed somewhere.
//   - A static import of the whole catalogue would bundle all 1355 photo records
//     into the client payload of every gallery page. As a content collection each
//     album lives in its own D1 row, so /archives/galerie can `.select()` just the
//     album metadata and an album page fetches only its own photos.
//
// Idempotent and deterministic: wipes content/galerie/ and re-emits sorted,
// stable JSON, so a rerun with an unchanged catalogue produces no git diff.
//
// Usage: node scripts/generate-galerie-content.mjs

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CATALOGUE = resolve(ROOT, '.archive-import/galerie.json')
const OUT_DIR = resolve(ROOT, 'content/galerie')

const catalogue = JSON.parse(await readFile(CATALOGUE, 'utf8'))

await rm(OUT_DIR, { recursive: true, force: true })
await mkdir(OUT_DIR, { recursive: true })

// Per-year aggregates, so /archives can build a year-by-year timeline mixing
// articles and photo albums WITHOUT loading all 1355 photo records into the hub
// page's payload. 34 albums each carrying a small map is a few KB; the photos
// themselves would be ~150 KB.
const THUMBS_PER_YEAR = 4

// One entry per (album, year): how many photos, the date span within that year,
// and a few thumbnails. `from` is what lets an album interleave with articles at
// month/day precision in the /archives timeline instead of all albums piling up
// at the start of their year.
function yearAggregates(album) {
  const byYear = {}
  for (const photo of album.photos) {
    const year = photo.date?.slice(0, 4)
    if (!year || !/^\d{4}$/.test(year)) continue
    const entry = (byYear[year] ??= { count: 0, from: photo.date, to: photo.date, thumbs: [] })
    entry.count += 1
    // Photos arrive already sorted chronologically, so min/max reduce to a
    // straight comparison and the first N thumbs are a deterministic sample.
    if (photo.date < entry.from) entry.from = photo.date
    if (photo.date > entry.to) entry.to = photo.date
    if (entry.thumbs.length < THUMBS_PER_YEAR) {
      entry.thumbs.push({ src: photo.src, w: photo.w, h: photo.h, alt: photo.alt })
    }
  }
  return { byYear }
}

let photos = 0
for (const album of catalogue.albums) {
  // `sourcePath` and `bytes` are import-time bookkeeping the site never renders —
  // dropping them keeps the D1 rows (and the album page payload) lean. Everything
  // else is passed through, and optional keys are omitted rather than emitted as
  // null so absent captions don't inflate 1355 rows.
  const record = {
    key: album.key,
    title: album.title,
    kind: album.kind,
    count: album.count,
    years: album.years,
    ...(album.dateRange ? { dateRange: album.dateRange } : {}),
    ...yearAggregates(album),
    cover: album.cover,
    photos: album.photos.map(p => ({
      src: p.src,
      w: p.w,
      h: p.h,
      alt: p.alt,
      ...(p.date ? { date: p.date } : {}),
      ...(p.dateSource ? { dateSource: p.dateSource } : {}),
      ...(p.title ? { title: p.title } : {}),
      ...(p.description ? { description: p.description } : {}),
      ...(p.articles?.length ? { articles: p.articles } : {}),
    })),
  }
  photos += record.photos.length
  await writeFile(resolve(OUT_DIR, `${album.key}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}

console.log(`Wrote ${catalogue.albums.length} album file(s) / ${photos} photos to content/galerie/`)
