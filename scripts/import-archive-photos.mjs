#!/usr/bin/env node
// One-time importer: mines the Joomla SFTP photo backup
// (../ptank-sftp-backup/photos, 3186 files deduped by sha256, see its
// MANIFEST.tsv/README.md) for real club photos, groups them into albums
// (one per top-level subdirectory of the four trees we actually want:
// petanque/, phocagallery/, gallery/, headers/ — everything else in that
// backup is Joomla admin-UI chrome: toolbars, menu sprites, etc.), downscales
// them, and stages the result under .archive-import/ for a later R2 upload
// step plus a JSON catalogue the /archives gallery pages will read.
//
// Why JPEG @ max 2000px long edge, q82: the site serves images through
// Cloudflare Image Transformations, which re-encodes everything on the way
// out anyway — there is no point shipping 12MP originals or keeping PNG for
// photographic content. We keep PNG only when the source has real alpha
// (logos/blasons) since flattening transparency would visibly break those.
//
// This script is idempotent (wipes its own output dir first) and safe to
// re-run; it never touches R2, content/, or any file outside the three paths
// listed in its header comment contract. Run from the repo root:
//   node scripts/import-archive-photos.mjs [--dry-run] [--limit=N] [--album=key] [--catalogue-only] [--metadata-only]
//
// --catalogue-only: rebuild galerie.json (and apply only the file moves/
// renames a catalogue-only change requires, e.g. an album key merge) WITHOUT
// re-running ImageMagick's resize+encode on every unchanged photo. It shares
// the exact same enumerate/filter/hash/group/title/kind/years code path as a
// normal run — the only difference is in step 8, where each item first tries
// to reuse (and rename/move into place if needed) the file a previous run
// already converted, falling back to a real conversion if nothing usable is
// found on disk. A plain full run (no flag) always re-converts everything
// and is therefore guaranteed to reproduce byte-identical output structure.
//
// --metadata-only: enrich the EXISTING galerie.json in place with per-photo
// `date`/`dateSource`/`articles`/`title` and a per-album `dateRange`, WITHOUT
// touching the staged images at all — no walk/filter/hash/group/convert, no
// file moves, no ImageMagick resize+encode. It loads the catalogue already
// on disk, reads EXIF DateTimeOriginal (batched `magick identify`, capped at
// EXIF_CONCURRENCY child processes — see runMetadataOnly()) from the
// ORIGINAL source files under PHOTOS_ROOT, cross-references staged
// content/archives/**/*.md articles by content hash against the staged
// article images under .archive-import/images/archives/, sorts each album's
// `photos` chronologically, and rewrites galerie.json. Every other flag
// (--dry-run/--limit/--album/--catalogue-only) is ignored when this is set.
// Every field this mode does not explicitly document — key, title, kind,
// count, years, cover, and each photo's src/w/h/alt/sourcePath/bytes — is
// carried over byte-for-value from the loaded catalogue.
//
// ImageMagick v7 (`magick`) is required — NOT the v6 `convert` shim.

import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const PHOTOS_ROOT = path.resolve(REPO_ROOT, '..', 'ptank-sftp-backup', 'photos')
// ARCHIVE_IMPORT_OUT_DIR lets verification runs (e.g. a --album=<small>
// smoke test of the conversion code path) write to an isolated scratch
// directory instead of the real staged output — never set in normal use.
const OUT_BASE = process.env.ARCHIVE_IMPORT_OUT_DIR
  ? path.resolve(process.env.ARCHIVE_IMPORT_OUT_DIR)
  : path.join(REPO_ROOT, '.archive-import')
const OUT_IMAGES_ROOT = path.join(OUT_BASE, 'images', 'galerie')
const OUT_JSON = path.join(OUT_BASE, 'galerie.json')

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const LIMIT = (() => {
  const a = args.find((x) => x.startsWith('--limit='))
  return a ? Number(a.slice('--limit='.length)) : Infinity
})()
const ALBUM_FILTER = (() => {
  const a = args.find((x) => x.startsWith('--album='))
  return a ? a.slice('--album='.length) : null
})()
const CATALOGUE_ONLY = args.includes('--catalogue-only')
const METADATA_ONLY = args.includes('--metadata-only')

const CONCURRENCY = 8
const MAX_LONG_EDGE = 2000
const JPEG_QUALITY = 82
const MIN_BYTES = 15 * 1024
const MIN_LONG_EDGE = 320
const MIN_GIF_BYTES = 50 * 1024
const MIN_GIF_LONG_EDGE = 400

// ---------------------------------------------------------------------------
// --metadata-only tuning. A previous parallel run of this script's normal
// ImageMagick convert step OOM-killed a dev server on this machine — the
// metadata pass only ever calls `magick identify` (cheap header/EXIF reads,
// no resize/encode), but we still cap how many child processes run at once
// and batch many paths per invocation rather than spawning per file.
// ---------------------------------------------------------------------------
const EXIF_CHILD_PROCESS_CONCURRENCY = 6
const EXIF_BATCH_SIZE = 150
const EXIF_YEAR_MIN = 1990
const EXIF_YEAR_MAX = 2026
const EXIF_GARBAGE_PREFIXES = ['0000:00:00', '1970:01:01', '1980:01:01']
// A camera whose clock was never set free-runs from a factory default of
// 1 Jan 2000 — empirically confirmed in this exact corpus: every single
// EXIF hit with year 2000/2001/2002 (35 photos, clustering into a handful of
// distinct dates shared across otherwise-unrelated shooting sessions) sits
// in a folder whose path-inferred year is 15+ years later (AG2018/AG2019/
// AG2020, Rassemblements/2019, Telethon/2019, Fetes/Voeux/2019/2020,
// boulodrome...) — zero exceptions, and zero EXIF hits at all in 1990-1999.
// The club's own records (JOURNAUX) only go back to Dec 2008, so a genuine
// 2000-2002 photo isn't plausible here either. Treat this whole band as the
// same camera-default-clock garbage as the exact prefixes above.
const EXIF_GARBAGE_YEAR_MAX = 2002
const CONTENT_ARCHIVES_ROOT = path.join(REPO_ROOT, 'content', 'archives')
const ARTICLE_IMAGES_ROOT = path.join(OUT_BASE, 'images', 'archives')
const PHOTOS_MANIFEST = path.join(PHOTOS_ROOT, 'MANIFEST.tsv')

// ---------------------------------------------------------------------------
// Included top-level trees
// ---------------------------------------------------------------------------
const INCLUDED_ROOTS = ['petanque', 'phocagallery', 'gallery', 'headers']
const KEEP_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])

// ---------------------------------------------------------------------------
// Album title mapping (directory-name -> human French title). Keys are
// matched case-sensitively against the RAW first-level directory name (before
// slugifying), since several dirs differ only by case (cc_ete / CC_ete) and
// must still collapse onto the same album key — the map below is consulted
// with a case-insensitive lookup (see titleForDir()).
// ---------------------------------------------------------------------------
const KNOWN_TITLES = new Map(
  Object.entries({
    cdc: 'Championnat des clubs',
    cc_ete: 'Coupe du club été',
    assembl_generale: 'Assemblée générale',
    fete_du_club: 'Fête du club',
    fete_des_pommiers: 'Fête des pommiers',
    // divers_petanque is intentionally absent here: it's merged into the
    // 'divers' album key directly in deriveAlbum() below, so it never
    // reaches titleForDir().
    blasons_gifs: 'Blasons',
    calend_annuel: 'Calendriers annuels',
    rglt_tenue_ffpjp: 'Règlement des tenues FFPJP',
    quest_loic_arbit: 'Questionnaire de Loïc, arbitre',
    tir_de_precision: 'Tir de précision',
    scan_carnet: 'Carnets scannés',
    repas_bene_23: 'Repas des bénévoles 2023',
    noel_petan23: 'Noël du club 2023',
    telethon_23: 'Téléthon 2023',
    ag2526: 'Assemblée générale 2025-2026',
    journ_de_la_fem: 'Journée de la femme',
    marche_noel: 'Marché de Noël',
    defile_floral: 'Défilé floral',
    comite_directeur: 'Comité directeur',
    articles_presse: 'Articles de presse',
    petanque_ecole: "Pétanque à l'école",
    concours_veterans_seniors: 'Concours vétérans / seniors',
    '24_proven': 'Provençale 2024',
    covid_19: 'Covid-19',
    trombinoscope: 'Trombinoscope',
    boulodrome: 'Boulodrome',
    rassemblements: 'Rassemblements',
    trophee: 'Trophée',
    coupes: 'Coupes',
    telethon: 'Téléthon',
    affiches: 'Affiches',
    sponsors: 'Partenaires',
    tenues: 'Tenues',
    reglements: 'Règlements',
    fetes: 'Fêtes',
    chiboudic: 'Chiboudic',
    paysages: 'Paysages',
    gifs: 'Animations',
    bureau: 'Bureau',
    championnats: 'Championnats',
    images: 'Divers',
  }),
)

// Special-cased album keys that don't come from a first-level petanque/ dir.
const SPECIAL_ALBUM_TITLES = {
  'gallery/original': 'Photos récentes',
  phocagallery: 'Galerie photos',
  headers: 'Bannières du site',
  'petanque/divers': 'Divers', // files sitting directly in petanque/ root
}

// ---------------------------------------------------------------------------
// Album "kind" — documents (scans/artwork) vs photos (people/events).
// ---------------------------------------------------------------------------
const DOCUMENT_ALBUM_KEYS = new Set([
  'affiches',
  'calend-annuel',
  'reglements',
  'rglt-tenue-ffpjp',
  'scan-carnet',
  'blasons-gifs',
  'sponsors',
  'headers',
  'tenues',
  'quest-loic-arbit',
])

// ---------------------------------------------------------------------------
// Album "years" — confident, mechanical inference from sourcePath tokens.
// A 4-digit 19xx/20xx run is a direct year (e.g. "2013", "AG2021"); a bare
// 2-digit run glued to a word is read as 20xx (e.g. "cc_ete_22" -> 2022,
// "noel_petan23" -> 2023); a 4-digit run that ISN'T 19xx/20xx but splits
// into two CONSECUTIVE 2-digit years is read as a season spanning both
// (e.g. "ag2526" -> 2025, 2026). Anything else (camera serials/timestamps
// like "DSCN1234" or "IMG_20210815_143022") is deliberately left alone —
// no wild guessing.
// ---------------------------------------------------------------------------
const YEAR_MIN = 2000
const YEAR_MAX = 2026

function yearsFromToken(token, prevToken, nextToken, isFilename) {
  const m = /(\d+)$/.exec(token)
  if (!m) return []
  const digits = m[1]
  // Whole token is nothing but the digit run, e.g. a bare "2010" directory —
  // vs. glued onto letters, e.g. "AG2021" or "RassFou1910".
  const isBareToken = m[0] === token
  if (digits.length === 4) {
    const asYear = Number(digits)
    if (asYear >= YEAR_MIN && asYear <= YEAR_MAX) return [asYear]
    // A glued 19xx run (e.g. "RassFou1910") is far more often a sequential
    // photo counter than a real year — camera/export counters that happen to
    // start with 19 are common, genuine 19xx photos glued onto a word are
    // not. Only trust 19xx when the token is bare (nothing glued to it).
    if (isBareToken && asYear >= 1900 && asYear <= 1999) return [asYear]
    // Not a direct year. A season written as two glued, CONSECUTIVE 2-digit
    // years (e.g. "ag2526" -> 2025, 2026) is a directory/album *naming*
    // convention, not something photo filenames do — restrict to directories.
    if (isFilename) return []
    const y1 = 2000 + Number(digits.slice(0, 2))
    const y2 = 2000 + Number(digits.slice(2, 4))
    if (y1 >= YEAR_MIN && y1 <= YEAR_MAX && y2 === y1 + 1) return [y1, y2]
    return []
  }
  if (digits.length === 2) {
    // Individual photo FILENAMES overwhelmingly use a bare/glued 2-digit
    // suffix as a SEQUENCE number ("boul12", "inaugboul10", "act_pet_phas10",
    // "chalets25_1"/"_10"), not a year — restrict this heuristic to
    // directory/album names, which reliably use it as a year or season
    // abbreviation instead ("cc_ete_22", "noel_petan23", "24_proven").
    if (isFilename) return []
    // Within a directory name, a bare/glued 2-digit run wedged next to
    // ANOTHER purely-numeric token still reads as an index, not a year —
    // skip it rather than guess.
    const nextIsNumeric = nextToken !== undefined && /^\d+$/.test(nextToken)
    const prevEndsInDigit = prevToken !== undefined && /\d$/.test(prevToken)
    if (nextIsNumeric || prevEndsInDigit) return []
    const y = 2000 + Number(digits)
    if (y >= YEAR_MIN && y <= YEAR_MAX) return [y]
  }
  return []
}

function inferYears(sourcePaths) {
  const years = new Set()
  for (const sourcePath of sourcePaths) {
    const segments = sourcePath.split('/')
    segments.forEach((seg, segIdx) => {
      const isFilename = segIdx === segments.length - 1
      const tokens = seg.split(/[_\-.\s]+/).filter(Boolean)
      tokens.forEach((token, i) => {
        for (const y of yearsFromToken(token, tokens[i - 1], tokens[i + 1], isFilename)) {
          years.add(y)
        }
      })
    })
  }
  return Array.from(years).sort((a, b) => a - b)
}

// ---------------------------------------------------------------------------
// Slugify — mechanical, reversible, no invented words.
// ---------------------------------------------------------------------------
function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function slugify(s) {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

function safeFilename(name) {
  const ext = path.extname(name)
  const base = name.slice(0, name.length - ext.length)
  const safeBase = stripDiacritics(base)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  return (safeBase || 'img') + ext.toLowerCase()
}

function sentenceCase(s) {
  const lower = s.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function titleForDir(rawDirName) {
  const key = rawDirName.toLowerCase()
  if (KNOWN_TITLES.has(key)) return KNOWN_TITLES.get(key)
  const spaced = rawDirName.replace(/[_-]+/g, ' ').trim()
  return sentenceCase(spaced)
}

// ---------------------------------------------------------------------------
// Walk the filesystem
// ---------------------------------------------------------------------------
async function walk(dir) {
  const out = []
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      out.push(...(await walk(full)))
    } else if (e.isFile()) {
      out.push(full)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Album key/title derivation from a relative path (relative to PHOTOS_ROOT)
// ---------------------------------------------------------------------------
function deriveAlbum(relPath) {
  const parts = relPath.split(path.sep)
  const root = parts[0] // petanque | phocagallery | gallery | headers

  if (root === 'headers') {
    return { key: 'headers', title: SPECIAL_ALBUM_TITLES.headers }
  }

  if (root === 'gallery') {
    // Everything under gallery/ we care about is gallery/original/**
    return { key: 'gallery-original', title: SPECIAL_ALBUM_TITLES['gallery/original'] }
  }

  if (root === 'phocagallery') {
    if (parts.length <= 2) {
      // file directly in phocagallery/
      return { key: 'phocagallery', title: SPECIAL_ALBUM_TITLES.phocagallery }
    }
    const dirName = parts[1]
    return { key: `phocagallery-${slugify(dirName)}`, title: titleForDir(dirName) }
  }

  // root === 'petanque'
  if (parts.length <= 2) {
    // file directly in petanque/ root
    return { key: 'divers', title: SPECIAL_ALBUM_TITLES['petanque/divers'] }
  }
  const dirName = parts[1] // first level under petanque/, flattening deeper nesting
  // petanque/Divers_petanque/** and the loose petanque/-root files handled
  // above were always meant to be ONE "Divers" album, not two separate
  // albums that merely share a title. Merge at the source, inside the same
  // grouping/collision-suffix machinery every other album goes through,
  // instead of bolting a merge on after the fact.
  if (dirName.toLowerCase() === 'divers_petanque') {
    return { key: 'divers', title: SPECIAL_ALBUM_TITLES['petanque/divers'] }
  }
  return { key: slugify(dirName), title: titleForDir(dirName) }
}

// ---------------------------------------------------------------------------
// Hashing / identify helpers
// ---------------------------------------------------------------------------
function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

// magick identify in chunks — avoid one process per file and ARG_MAX blowout.
async function identifyBatch(filePaths) {
  const results = new Map()
  const CHUNK = 200
  for (let i = 0; i < filePaths.length; i += CHUNK) {
    const chunk = filePaths.slice(i, i + CHUNK)
    let stdout
    try {
      ;({ stdout } = await execFileP(
        'magick',
        ['identify', '-format', '%i\t%w\t%h\t%m\t%A\t%n\n', ...chunk],
        { maxBuffer: 1024 * 1024 * 64 },
      ))
    } catch {
      // Some file in the batch may be unreadable/corrupt; fall back to
      // per-file identify for this chunk so one bad file doesn't lose the
      // rest of the batch's data.
      stdout = ''
      for (const f of chunk) {
        try {
          const r = await execFileP('magick', ['identify', '-format', '%i\t%w\t%h\t%m\t%A\t%n\n', f])
          stdout += r.stdout
        } catch {
          // leave unresolved; caller treats missing entries as convert failures
        }
      }
    }
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue
      const [file, w, h, format, alpha, frames] = line.split('\t')
      // %i is the full path passed in (possibly repeated per-frame for GIFs);
      // keep the first occurrence (frame 0) for dimensions.
      if (!results.has(file)) {
        results.set(file, {
          width: Number(w),
          height: Number(h),
          format,
          alpha,
          frames: Number(frames) || 1,
        })
      }
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Small worker-pool runner
// ---------------------------------------------------------------------------
async function runPool(items, concurrency, worker) {
  let idx = 0
  const results = new Array(items.length)
  async function next() {
    while (true) {
      const i = idx++
      if (i >= items.length) return
      results[i] = await worker(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next))
  return results
}

// ---------------------------------------------------------------------------
// --metadata-only: EXIF date extraction
// ---------------------------------------------------------------------------

// Validate + normalise one EXIF datetime string ("YYYY:MM:DD HH:MM:SS") into
// "YYYY-MM-DD", rejecting out-of-range years and the common camera-default
// garbage values. Returns null on anything not confidently a real date.
function parseExifDate(raw) {
  if (!raw) return null
  const s = raw.trim()
  if (!s) return null
  if (EXIF_GARBAGE_PREFIXES.some((p) => s.startsWith(p))) return null
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T]\d{2}:\d{2}:\d{2}/.exec(s)
  if (!m) return null
  const [, y, mo, d] = m
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  if (year < EXIF_YEAR_MIN || year > EXIF_YEAR_MAX) return null
  if (year <= EXIF_GARBAGE_YEAR_MAX) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${y}-${mo}-${d}`
}

// Batched, concurrency-capped `magick identify` over EXIF:DateTimeOriginal
// (falling back to CreateDate, then DateTimeDigitized) for a list of
// absolute source-file paths. Returns Map<absPath, "YYYY-MM-DD"> — only for
// files where a plausible date was found.
async function batchExifDates(absPaths) {
  const results = new Map()
  const batches = []
  for (let i = 0; i < absPaths.length; i += EXIF_BATCH_SIZE) {
    batches.push(absPaths.slice(i, i + EXIF_BATCH_SIZE))
  }
  const FORMAT = '%i\t%[EXIF:DateTimeOriginal]\t%[EXIF:CreateDate]\t%[EXIF:DateTimeDigitized]\n'
  await runPool(batches, EXIF_CHILD_PROCESS_CONCURRENCY, async (batch) => {
    let stdout
    try {
      ;({ stdout } = await execFileP('magick', ['identify', '-format', FORMAT, ...batch], {
        maxBuffer: 1024 * 1024 * 64,
      }))
    } catch {
      // Some file in the batch may be unreadable/corrupt — fall back to
      // per-file identify for this chunk so one bad file doesn't lose the
      // rest of the batch's data.
      stdout = ''
      for (const f of batch) {
        try {
          const r = await execFileP('magick', ['identify', '-format', FORMAT, f])
          stdout += r.stdout
        } catch {
          // leave unresolved
        }
      }
    }
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue
      const parts = line.split('\t')
      const file = parts[0]
      if (results.has(file)) continue // multi-frame images repeat %i; keep frame 0
      for (const candidate of [parts[1], parts[2], parts[3]]) {
        const d = parseExifDate(candidate)
        if (d) {
          results.set(file, d)
          break
        }
      }
    }
  })
  return results
}

// ---------------------------------------------------------------------------
// --metadata-only: chronological sort helpers
// ---------------------------------------------------------------------------

// Pad a partial "YYYY" / "YYYY-MM" / "YYYY-MM-DD" date string to a
// fully-comparable "YYYY-MM-DD" sort key ("2016" -> "2016-00-00").
function dateSortKey(dateStr) {
  const parts = dateStr.split('-')
  while (parts.length < 3) parts.push('00')
  return parts.join('-')
}

// Absolute difference, in whole months, between two "YYYY-MM[-DD]" strings —
// used only for the EXIF-vs-article sanity check (report only, never changes
// either value).
function monthsBetween(dateA, dateB) {
  const [ya, ma] = dateA.split('-').map(Number)
  const [yb, mb] = dateB.split('-').map(Number)
  return Math.abs((ya * 12 + (ma - 1)) - (yb * 12 + (mb - 1)))
}

// Dated photos sort ascending by date (ties broken by sourcePath for
// determinism); undated photos sort last, by sourcePath.
function photoSortComparator(a, b) {
  const ka = a.date ? dateSortKey(a.date) : null
  const kb = b.date ? dateSortKey(b.date) : null
  if (ka && kb) {
    if (ka !== kb) return ka < kb ? -1 : 1
    return a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : 0
  }
  if (ka && !kb) return -1
  if (!ka && kb) return 1
  return a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : 0
}

// ---------------------------------------------------------------------------
// --metadata-only: bulk-import `date` artefact detection
// ---------------------------------------------------------------------------
// The Joomla `created` timestamp that ends up as frontmatter `date:` is
// reliable for most articles, but several migration/bulk-edit passes reset
// whole batches of UNRELATED articles to the same day. Empirically: counting
// how many distinct content/archives/**/*.md articles share each exact
// `date:` value (across all 244 files) shows a clean break in the
// distribution — 2013-07-05 (37 articles), 2013-11-01 (11), 2018-12-19 (11),
// 2023-01-28 (10), 2021-12-31 (9), and 2024-01-01 (6) are each shared by
// 6-37 articles, and EVERY single one of those articles carries a
// `journal:` field whose real period disagrees with every OTHER article
// sharing that "date" (e.g. the 37 articles on 2013-07-05 are 37 different
// journal issues spanning 2010-2013) — a mechanical contradiction that
// proves the date is a bulk-write artefact, not a real shared publish day.
// Below that, every other date value is shared by at most 4 articles, some
// of which are legitimately batch-created same-day (e.g. 4 CDC standings
// pages for one championship, posted together, no journal field at all, no
// contradiction). BULK_IMPORT_DATE_MIN_COUNT=5 sits exactly in that gap, and
// is applied to a live count rather than a hardcoded date list, so it
// self-corrects if content/archives changes.
const BULK_IMPORT_DATE_MIN_COUNT = 5

// Count how many distinct articles share each exact `date:` value across
// every content/archives/<year>/*.md file (all 244, not just the ones with
// staged images), and return Map<date, count> for values at/above the
// threshold above.
async function computeBulkImportDates() {
  const counts = new Map()
  let years
  try {
    years = (await fs.readdir(CONTENT_ARCHIVES_ROOT, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return new Map()
  }
  for (const year of years) {
    let files
    try {
      files = (await fs.readdir(path.join(CONTENT_ARCHIVES_ROOT, year), { withFileTypes: true }))
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name)
    } catch {
      continue
    }
    for (const file of files) {
      const md = await fs.readFile(path.join(CONTENT_ARCHIVES_ROOT, year, file), 'utf8')
      const fm = /^---\n([\s\S]*?)\n---/.exec(md)
      if (!fm) continue
      const dateM = /^date:\s*(\S+)\s*$/m.exec(fm[1])
      if (!dateM) continue
      counts.set(dateM[1], (counts.get(dateM[1]) || 0) + 1)
    }
  }
  const bulkImportDates = new Map()
  for (const [date, count] of counts) {
    if (count >= BULK_IMPORT_DATE_MIN_COUNT) bulkImportDates.set(date, count)
  }
  return bulkImportDates
}

// Parse a `journal:` frontmatter value ("YYYY-MM", or a two-month span like
// "2015-07-08" for July/August) into the "YYYY-MM" period the issue covers.
// Defensive: takes the leading YYYY and the FIRST MM right after it, ignores
// any further digits, and validates the month is 01-12. Returns null on
// anything not confidently a real period.
function parseJournalPeriod(raw) {
  if (!raw) return null
  const m = /^(\d{4})-(\d{2})/.exec(raw.trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  if (year < EXIF_YEAR_MIN || year > EXIF_YEAR_MAX) return null
  if (month < 1 || month > 12) return null
  return `${m[1]}-${m[2]}`
}

// An article's best-known date:
//   1. `journal:` present and parses -> that period (precision: month).
//   2. else `date:` present AND not a known bulk-import artefact -> as-is.
//   3. else -> null (no reliable date; the article LINK is kept regardless —
//      it's independently correct, it came from a content hash).
function resolveArticleDate(journalRaw, dateRaw, bulkImportDates) {
  const journalPeriod = parseJournalPeriod(journalRaw)
  if (journalPeriod) return journalPeriod
  if (dateRaw && !bulkImportDates.has(dateRaw)) return dateRaw
  return null
}

// ---------------------------------------------------------------------------
// --metadata-only: article registry (frontmatter) + content-hash matching
// ---------------------------------------------------------------------------

// Enumerate <year>/<slug> dirs under ARTICLE_IMAGES_ROOT that have a
// corresponding generated content/archives/<year>/<slug>.md, and parse that
// file's frontmatter for title/date/journal. Dirs with no matching .md
// (shouldn't happen, but the brief requires only ever linking published
// articles) are silently skipped.
async function loadArticleRegistry(bulkImportDates) {
  const articleMeta = new Map() // "year/slug" -> { path, title, date? }
  let years
  try {
    years = (await fs.readdir(ARTICLE_IMAGES_ROOT, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return articleMeta
  }
  for (const year of years) {
    let slugs
    try {
      slugs = (await fs.readdir(path.join(ARTICLE_IMAGES_ROOT, year), { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    } catch {
      continue
    }
    for (const slug of slugs) {
      const mdPath = path.join(CONTENT_ARCHIVES_ROOT, year, `${slug}.md`)
      if (!existsSync(mdPath)) continue
      const md = await fs.readFile(mdPath, 'utf8')
      const fm = /^---\n([\s\S]*?)\n---/.exec(md)
      if (!fm) continue
      const titleM = /^title:\s*"(.*)"\s*$/m.exec(fm[1])
      if (!titleM) continue
      const dateM = /^date:\s*(\S+)\s*$/m.exec(fm[1])
      const journalM = /^journal:\s*"?([^"\n]+)"?\s*$/m.exec(fm[1])
      const resolvedDate = resolveArticleDate(
        journalM ? journalM[1] : null,
        dateM ? dateM[1] : null,
        bulkImportDates,
      )
      articleMeta.set(`${year}/${slug}`, {
        path: `/archives/${year}/${slug}`,
        title: titleM[1],
        ...(resolvedDate ? { date: resolvedDate } : {}),
      })
    }
  }
  return articleMeta
}

// Hash every staged article image belonging to a PUBLISHED article (i.e.
// present in articleMeta) and invert into sha256 -> Set<"year/slug">.
async function buildArticleImageHashIndex(articleMeta) {
  const files = []
  for (const key of articleMeta.keys()) {
    const [year, slug] = key.split('/')
    const dir = path.join(ARTICLE_IMAGES_ROOT, year, slug)
    let names
    try {
      names = (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name)
    } catch {
      continue
    }
    for (const name of names) files.push({ abs: path.join(dir, name), articleKey: key })
  }
  const sha256ToArticles = new Map()
  await runPool(files, 16, async (f) => {
    const hash = await sha256File(f.abs)
    if (!sha256ToArticles.has(hash)) sha256ToArticles.set(hash, new Set())
    sha256ToArticles.get(hash).add(f.articleKey)
  })
  return sha256ToArticles
}

// Load photos/MANIFEST.tsv as Map<pathRelativeToPhotosRoot, sha256> — reuse
// its already-computed hashes for the 1355 gallery photos instead of
// rehashing every one of them.
async function loadPhotosManifest() {
  const raw = await fs.readFile(PHOTOS_MANIFEST, 'utf8')
  const map = new Map()
  const lines = raw.split('\n')
  for (let i = 1; i < lines.length; i++) {
    // skip header
    const line = lines[i]
    if (!line) continue
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    const sha = line.slice(0, tab)
    const rest = line.slice(tab + 1)
    const tab2 = rest.indexOf('\t')
    const p = tab2 === -1 ? rest : rest.slice(0, tab2)
    if (sha && p) map.set(p, sha)
  }
  return map
}

// ---------------------------------------------------------------------------
// --metadata-only: main entry point
// ---------------------------------------------------------------------------
async function runMetadataOnly() {
  const catalogue = JSON.parse(await fs.readFile(OUT_JSON, 'utf8'))

  console.log('Computing bulk-import `date` artefacts (content/archives frontmatter)...')
  const bulkImportDates = await computeBulkImportDates()
  console.log(`  ${bulkImportDates.size} bulk-import date value(s) found (threshold: >=${BULK_IMPORT_DATE_MIN_COUNT} articles sharing the exact date).`)

  console.log('Loading article registry (content/archives frontmatter)...')
  const articleMeta = await loadArticleRegistry(bulkImportDates)
  console.log(`  ${articleMeta.size} published archive article(s) found.`)

  console.log('Hashing staged article images...')
  const sha256ToArticles = await buildArticleImageHashIndex(articleMeta)

  console.log('Loading photos/MANIFEST.tsv...')
  const manifestMap = await loadPhotosManifest()

  const allPhotos = []
  const albumKeyBySourcePath = new Map()
  for (const album of catalogue.albums) {
    for (const photo of album.photos) {
      allPhotos.push(photo)
      albumKeyBySourcePath.set(photo.sourcePath, album.key)
    }
  }

  console.log(`Reading EXIF dates for ${allPhotos.length} original source file(s) (batched, capped at ${EXIF_CHILD_PROCESS_CONCURRENCY} child processes)...`)
  const exifResults = await batchExifDates(
    allPhotos.map((p) => path.join(PHOTOS_ROOT, ...p.sourcePath.split('/'))),
  )

  const dateStats = { exif: 0, article: 0, path: 0, none: 0 }
  let photosWithArticle = 0
  let totalLinks = 0
  let photosWithTitle = 0
  let photoDateChanged = 0
  let articleDateChanged = 0

  for (const photo of allPhotos) {
    // ---- snapshot pre-fix values, for the before/after diff in the report -
    const oldDate = photo.date
    const oldArticleDateByPath = new Map()
    if (photo.articles) {
      for (const a of photo.articles) oldArticleDateByPath.set(a.path, a.date)
    }

    // ---- 2. articles (content-hash match) --------------------------------
    const sha = manifestMap.get(photo.sourcePath)
    const articleKeys = sha ? sha256ToArticles.get(sha) : undefined
    let articles
    if (articleKeys && articleKeys.size > 0) {
      const list = Array.from(articleKeys)
        .map((k) => articleMeta.get(k))
        .filter(Boolean)
      // Dated articles first (ascending by resolved date), undated articles
      // last; either way tie-broken by path for determinism.
      list.sort((a, b) => {
        if (a.date && b.date) {
          if (a.date !== b.date) return a.date < b.date ? -1 : 1
        } else if (a.date && !b.date) {
          return -1
        } else if (!a.date && b.date) {
          return 1
        }
        return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
      })
      if (list.length > 0) articles = list
    }
    if (articles) {
      photo.articles = articles
      photosWithArticle++
      totalLinks += articles.length
      for (const a of articles) {
        if (oldArticleDateByPath.get(a.path) !== a.date) articleDateChanged++
      }
      // ---- 3. title (only when exactly one linked article) ---------------
      if (articles.length === 1) {
        photo.title = articles[0].title
        photosWithTitle++
      }
    }

    // ---- 1. date / dateSource (EXIF > article > path) ---------------------
    const abs = path.join(PHOTOS_ROOT, ...photo.sourcePath.split('/'))
    const exifDate = exifResults.get(abs)
    const firstDatedArticle = articles ? articles.find((a) => a.date) : undefined
    if (exifDate) {
      photo.date = exifDate
      photo.dateSource = 'exif'
      dateStats.exif++
    } else if (firstDatedArticle) {
      photo.date = firstDatedArticle.date
      photo.dateSource = 'article'
      dateStats.article++
    } else {
      const years = inferYears([photo.sourcePath])
      if (years.length === 1) {
        photo.date = String(years[0])
        photo.dateSource = 'path'
        dateStats.path++
      } else {
        photo.date = undefined
        photo.dateSource = undefined
        dateStats.none++
      }
    }
    if (photo.date !== oldDate) photoDateChanged++
  }

  // ---- (d) EXIF vs resolved-article-period sanity check (report only) ----
  // Now that most articles have a trustworthy month (from `journal:`), cross-
  // check it against EXIF for photos that have both. Never changes either
  // value — this is purely diagnostic.
  const exifArticleDisagreements = []
  for (const photo of allPhotos) {
    const abs = path.join(PHOTOS_ROOT, ...photo.sourcePath.split('/'))
    const exifDate = exifResults.get(abs)
    if (!exifDate || !photo.articles) continue
    const datedArticle = photo.articles.find((a) => a.date)
    if (!datedArticle) continue
    const diffMonths = monthsBetween(exifDate, datedArticle.date)
    if (diffMonths > 18) {
      exifArticleDisagreements.push({
        sourcePath: photo.sourcePath,
        albumKey: albumKeyBySourcePath.get(photo.sourcePath),
        exifDate,
        articleDate: datedArticle.date,
        articlePath: datedArticle.path,
        diffMonths,
      })
    }
  }
  exifArticleDisagreements.sort((a, b) => b.diffMonths - a.diffMonths)

  // ---- 4. sort each album's photos chronologically + dateRange -----------
  for (const album of catalogue.albums) {
    album.photos.sort(photoSortComparator)
    const dated = album.photos.filter((p) => p.date)
    if (dated.length > 0) {
      const sortedByKey = dated.slice().sort((a, b) => {
        const ka = dateSortKey(a.date)
        const kb = dateSortKey(b.date)
        return ka < kb ? -1 : ka > kb ? 1 : 0
      })
      album.dateRange = { from: sortedByKey[0].date, to: sortedByKey[sortedByKey.length - 1].date }
    } else {
      album.dateRange = undefined
    }
  }

  await fs.writeFile(OUT_JSON, JSON.stringify(catalogue, null, 2) + '\n')

  console.log('\n=== METADATA-ONLY REPORT ===')
  console.log('\nBulk-import `date` artefacts (>= ' + BULK_IMPORT_DATE_MIN_COUNT + ' articles sharing the exact date):')
  const bulkRows = Array.from(bulkImportDates.entries()).sort((a, b) => b[1] - a[1])
  for (const [date, count] of bulkRows) console.log(`  ${date}  ${count} article(s)`)
  console.log(`\nPhotos with date: exif=${dateStats.exif} article=${dateStats.article} path=${dateStats.path} none=${dateStats.none}`)
  console.log(`Photos with >=1 article link: ${photosWithArticle} (total links: ${totalLinks})`)
  console.log(`Photos with a title: ${photosWithTitle}`)
  console.log(`\nphoto.date changed: ${photoDateChanged}`)
  console.log(`articles[].date changed: ${articleDateChanged}`)
  console.log(`\nEXIF vs resolved-article-period disagreements (>18 months): ${exifArticleDisagreements.length}`)
  for (const d of exifArticleDisagreements.slice(0, 10)) {
    console.log(`  [${d.albumKey}] ${d.sourcePath}  exif=${d.exifDate} article(${d.articlePath})=${d.articleDate}  (${d.diffMonths}mo)`)
  }
  console.log('\nAlbum dateRange:')
  for (const album of catalogue.albums) {
    console.log(`  ${album.key.padEnd(28)} ${album.dateRange ? `${album.dateRange.from} .. ${album.dateRange.to}` : '(none)'}`)
  }
  console.log(`\nCatalogue: ${OUT_JSON}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!existsSync(PHOTOS_ROOT)) {
    console.error(`Photo backup not found at ${PHOTOS_ROOT}`)
    process.exit(1)
  }

  if (METADATA_ONLY) {
    await runMetadataOnly()
    return
  }

  const skipped = {
    tooSmall: 0,
    tooLowRes: 0,
    excludedDir: 0,
    duplicate: 0,
    convertFailed: 0,
    animatedGif: 0,
  }

  // ---- 1. Enumerate candidate files -------------------------------------
  const allFiles = await walk(PHOTOS_ROOT)
  const candidates = []
  for (const abs of allFiles) {
    const rel = path.relative(PHOTOS_ROOT, abs)
    const root = rel.split(path.sep)[0]
    if (!INCLUDED_ROOTS.includes(root)) {
      skipped.excludedDir++
      continue
    }
    const ext = path.extname(rel).toLowerCase()
    if (!KEEP_EXTENSIONS.has(ext)) {
      // Not one of the requested skip counters (e.g. stray .bmp) — silently
      // excluded, mechanically outside the "keep extensions" allowlist.
      continue
    }
    candidates.push({ abs, rel, ext })
  }

  // ---- 2. Size filter (cheap, before spawning magick) --------------------
  const sized = []
  for (const c of candidates) {
    const st = await fs.stat(c.abs)
    if (st.size < MIN_BYTES) {
      skipped.tooSmall++
      continue
    }
    sized.push({ ...c, bytes: st.size })
  }

  // ---- 3. Batch identify (dimensions, format, alpha, frame count) -------
  const identified = await identifyBatch(sized.map((c) => c.abs))

  const dimensionFiltered = []
  for (const c of sized) {
    const info = identified.get(c.abs)
    if (!info) {
      skipped.convertFailed++
      continue
    }
    const longEdge = Math.max(info.width, info.height)
    const isGif = c.ext === '.gif' || info.format === 'GIF'
    if (isGif) {
      if (info.frames > 1) {
        skipped.animatedGif++
        continue
      }
      if (c.bytes < MIN_GIF_BYTES || longEdge < MIN_GIF_LONG_EDGE) {
        // Static GIF too small to be a real scanned photo — falls under the
        // general low-res/too-small buckets depending on which threshold it
        // missed; charge to tooLowRes as the more specific reason when size
        // was fine, else tooSmall.
        if (c.bytes < MIN_GIF_BYTES) skipped.tooSmall++
        else skipped.tooLowRes++
        continue
      }
    } else if (longEdge < MIN_LONG_EDGE) {
      skipped.tooLowRes++
      continue
    }
    dimensionFiltered.push({ ...c, ...info, longEdge })
  }

  // ---- 4. Content-hash dedupe (same photo, two paths within included set)
  const hashes = await runPool(dimensionFiltered, CONCURRENCY, async (c) => ({
    ...c,
    sha256: await sha256File(c.abs),
  }))

  // Album is derived up front so we can prefer "the most descriptive album"
  // when the same hash appears at multiple paths. Heuristic: prefer the copy
  // whose album is NOT the catch-all "divers"/"phocagallery"/"gallery-original"
  // bucket, then prefer the shorter path (closer to the album root, less
  // deeply nested legacy re-export), then prefer the first alphabetically for
  // determinism.
  const CATCHALL_KEYS = new Set(['divers', 'phocagallery', 'gallery-original'])
  function albumSpecificity(relPath) {
    const { key } = deriveAlbum(relPath)
    return CATCHALL_KEYS.has(key) ? 0 : 1
  }

  const byHash = new Map()
  for (const item of hashes) {
    const existing = byHash.get(item.sha256)
    if (!existing) {
      byHash.set(item.sha256, item)
      continue
    }
    const a = albumSpecificity(existing.rel)
    const b = albumSpecificity(item.rel)
    let winner = existing
    if (b > a) winner = item
    else if (b === a) {
      const depthA = existing.rel.split(path.sep).length
      const depthB = item.rel.split(path.sep).length
      if (depthB < depthA) winner = item
      else if (depthB === depthA && item.rel < existing.rel) winner = item
    }
    byHash.set(item.sha256, winner)
    skipped.duplicate++
  }

  let kept = Array.from(byHash.values())

  // ---- 5. Group into albums ----------------------------------------------
  const albumsMap = new Map() // key -> { title, items: [] }
  for (const item of kept) {
    const { key, title } = deriveAlbum(item.rel)
    if (!albumsMap.has(key)) albumsMap.set(key, { title, items: [] })
    albumsMap.get(key).items.push(item)
  }

  // Fold albums with < 3 images into "divers"
  const DIVERS_KEY = 'divers'
  if (!albumsMap.has(DIVERS_KEY)) {
    albumsMap.set(DIVERS_KEY, { title: SPECIAL_ALBUM_TITLES['petanque/divers'], items: [] })
  }
  for (const [key, album] of Array.from(albumsMap.entries())) {
    if (key === DIVERS_KEY) continue
    if (album.items.length < 3) {
      albumsMap.get(DIVERS_KEY).items.push(...album.items)
      albumsMap.delete(key)
    }
  }
  if (albumsMap.get(DIVERS_KEY).items.length === 0) {
    albumsMap.delete(DIVERS_KEY)
  }

  // ---- 6. Apply --album / --limit filters (selection-time only) ---------
  let selectedAlbumKeys = Array.from(albumsMap.keys())
  if (ALBUM_FILTER) {
    selectedAlbumKeys = selectedAlbumKeys.filter((k) => k === ALBUM_FILTER)
  }

  for (const key of selectedAlbumKeys) {
    const album = albumsMap.get(key)
    album.items.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
    if (Number.isFinite(LIMIT)) {
      album.items = album.items.slice(0, LIMIT)
    }
  }

  // ---- Report selection summary -------------------------------------------
  const totalSelected = selectedAlbumKeys.reduce((n, k) => n + albumsMap.get(k).items.length, 0)
  console.log(`\nSelected ${totalSelected} photo(s) across ${selectedAlbumKeys.length} album(s).`)

  if (DRY_RUN) {
    printSelectionReport(albumsMap, selectedAlbumKeys, skipped)
    return
  }

  // ---- 7. Wipe + recreate output dir -------------------------------------
  // --catalogue-only reuses whatever's already staged, so it must NOT wipe.
  if (!CATALOGUE_ONLY) {
    await fs.rm(OUT_IMAGES_ROOT, { recursive: true, force: true })
  }
  await fs.mkdir(OUT_IMAGES_ROOT, { recursive: true })

  // --catalogue-only: index the previous run's catalogue by sourcePath so
  // step 8 below can reuse already-converted files (moving them into place
  // under a possibly-new key/name) instead of paying for another
  // ImageMagick resize+encode. Absent/unreadable previous catalogue just
  // means every item falls through to a real conversion — self-healing.
  let reuseMap = null
  if (CATALOGUE_ONLY) {
    reuseMap = new Map()
    try {
      const oldCatalogue = JSON.parse(await fs.readFile(OUT_JSON, 'utf8'))
      for (const a of oldCatalogue.albums) {
        for (const p of a.photos) reuseMap.set(p.sourcePath, p)
      }
    } catch {
      // No previous catalogue to reuse from.
    }
  }

  // ---- 8. Convert ----------------------------------------------------------
  const convertFailures = []
  let sourceBytes = 0
  let outputBytes = 0

  for (const key of selectedAlbumKeys) {
    const album = albumsMap.get(key)
    const outDir = path.join(OUT_IMAGES_ROOT, key)
    await fs.mkdir(outDir, { recursive: true })

    const usedNames = new Set()
    const jobs = album.items.map((item) => {
      const base = safeFilename(path.basename(item.rel))
      const baseNoExt = base.replace(/\.[^.]+$/, '')
      let candidateName = base.replace(/\.[^.]+$/, '.jpg') // force .jpg by default
      const hasAlpha = item.alpha && item.alpha !== 'Undefined' && item.alpha !== 'False'
      if (hasAlpha) candidateName = base.replace(/\.[^.]+$/, '.png')
      let finalBase = candidateName
      let n = 2
      while (usedNames.has(finalBase)) {
        const ext = path.extname(candidateName)
        finalBase = `${baseNoExt}-${n}${ext}`
        n++
      }
      usedNames.add(finalBase)
      return { item, outPath: path.join(outDir, finalBase), hasAlpha }
    })

    const results = await runPool(jobs, CONCURRENCY, async (job) => {
      if (reuseMap) {
        const reused = await tryReuseConverted(job, reuseMap)
        if (reused) return reused
      }
      return convertOne(job)
    })
    for (const r of results) {
      if (!r) continue
      if (r.error) {
        convertFailures.push({ path: r.item.rel, error: r.error })
        skipped.convertFailed++
      } else {
        sourceBytes += r.item.bytes
        outputBytes += r.outBytes
        r.item.outWidth = r.outWidth
        r.item.outHeight = r.outHeight
        r.item.outPath = r.outPath
        r.item.outBytes = r.outBytes
      }
    }
    // Drop failed items from the album so the catalogue only lists what's
    // actually on disk.
    album.items = album.items.filter((it) => it.outPath)
  }

  // ---- 8b. Prune stale staged directories --------------------------------
  // After a normal run's wipe (step 7) this is a no-op — only selected
  // albums' directories exist at all. In --catalogue-only mode nothing was
  // wiped, so a key that no longer exists after this run's grouping (e.g.
  // divers-petanque folding into divers) can still be sitting on disk with
  // its files already moved out; remove it. Skipped for a filtered --album
  // run, which intentionally leaves every other album's directory alone.
  if (!ALBUM_FILTER) {
    let existingDirs = []
    try {
      existingDirs = (await fs.readdir(OUT_IMAGES_ROOT, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    } catch {
      // OUT_IMAGES_ROOT not readable (shouldn't happen, just created above).
    }
    const keepDirs = new Set(selectedAlbumKeys)
    for (const dir of existingDirs) {
      if (!keepDirs.has(dir)) {
        await fs.rm(path.join(OUT_IMAGES_ROOT, dir), { recursive: true, force: true })
      }
    }
  }

  // Re-check the < 3 rule after conversion failures could have thinned an
  // album — fold any newly-undersized album into divers too.
  for (const key of Array.from(selectedAlbumKeys)) {
    if (key === DIVERS_KEY) continue
    const album = albumsMap.get(key)
    if (album.items.length < 3 && album.items.length > 0) {
      if (!albumsMap.has(DIVERS_KEY)) {
        albumsMap.set(DIVERS_KEY, { title: SPECIAL_ALBUM_TITLES['petanque/divers'], items: [] })
        selectedAlbumKeys.push(DIVERS_KEY)
      }
      albumsMap.get(DIVERS_KEY).items.push(...album.items)
      album.items = []
    }
  }
  selectedAlbumKeys = selectedAlbumKeys.filter((k) => albumsMap.get(k).items.length > 0)

  // ---- 9. Build catalogue --------------------------------------------------
  const albumsOut = []
  for (const key of selectedAlbumKeys) {
    const album = albumsMap.get(key)
    const photos = album.items
      .slice()
      .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
      .map((it) => ({
        src: `/images/galerie/${key}/${path.basename(it.outPath)}`,
        w: it.outWidth,
        h: it.outHeight,
        alt: `${album.title} — photo d'archive du club`,
        sourcePath: it.rel.split(path.sep).join('/'),
        bytes: it.outBytes,
      }))
    if (photos.length === 0) continue
    const cover = photos.reduce((best, p) => (p.w * p.h > best.w * best.h ? p : best), photos[0])
    albumsOut.push({
      key,
      title: album.title,
      kind: DOCUMENT_ALBUM_KEYS.has(key) ? 'documents' : 'photos',
      count: photos.length,
      years: inferYears(photos.map((p) => p.sourcePath)),
      cover: cover.src,
      photos,
    })
  }

  albumsOut.sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

  const totals = {
    albums: albumsOut.length,
    photos: albumsOut.reduce((n, a) => n + a.count, 0),
    sourceBytes,
    outputBytes,
  }

  const catalogue = {
    generatedFrom: 'ptank-sftp-backup/photos',
    totals,
    albums: albumsOut,
    skipped,
  }

  await fs.mkdir(path.dirname(OUT_JSON), { recursive: true })
  await fs.writeFile(OUT_JSON, JSON.stringify(catalogue, null, 2) + '\n')

  // ---- 10. Report -----------------------------------------------------------
  printFinalReport(albumsOut, totals, skipped, convertFailures)
}

// --catalogue-only support: if a previous run already converted this exact
// source file (matched by sourcePath, which never changes across a title/key
// fix), move it into place under its current key/name instead of paying for
// another ImageMagick resize+encode. Returns null — falling through to a
// real conversion — if the previous catalogue has no entry for this item, or
// the file it points at isn't actually on disk.
async function tryReuseConverted(job, reuseMap) {
  const relPosix = job.item.rel.split(path.sep).join('/')
  const old = reuseMap.get(relPosix)
  if (!old) return null
  const m = /^\/images\/galerie\/([^/]+)\/([^/]+)$/.exec(old.src)
  if (!m) return null
  const oldAbsPath = path.join(OUT_IMAGES_ROOT, m[1], m[2])
  if (!existsSync(oldAbsPath)) return null
  const newPath = job.outPath
  if (path.resolve(oldAbsPath) !== path.resolve(newPath)) {
    await fs.mkdir(path.dirname(newPath), { recursive: true })
    await fs.rename(oldAbsPath, newPath)
  }
  let st
  try {
    st = await fs.stat(newPath)
  } catch {
    return null
  }
  return { item: job.item, outPath: newPath, outWidth: old.w, outHeight: old.h, outBytes: st.size }
}

async function convertOne({ item, outPath, hasAlpha }) {
  try {
    // NB: -auto-orient is an image *operator*, not a read-setting — it must
    // come AFTER the input file is read, not before (verified empirically:
    // `magick -auto-orient in.jpg ...` errors "no images found for operation").
    const args = [item.abs, '-auto-orient']
    if (hasAlpha) {
      args.push(
        '-resize', `${MAX_LONG_EDGE}x${MAX_LONG_EDGE}>`,
        '-strip',
        '-define', 'png:compression-level=9',
        outPath,
      )
    } else {
      args.push(
        '-resize', `${MAX_LONG_EDGE}x${MAX_LONG_EDGE}>`,
        '-strip',
        '-interlace', 'JPEG',
        '-sampling-factor', '4:2:0',
        '-quality', String(JPEG_QUALITY),
        outPath,
      )
    }
    await execFileP('magick', args)
    const info = await identifyBatch([outPath])
    const dims = info.get(outPath)
    const st = await fs.stat(outPath)
    if (!dims) throw new Error('identify failed on output')
    return { item, outPath, outWidth: dims.width, outHeight: dims.height, outBytes: st.size }
  } catch (err) {
    return { item, error: err.message || String(err) }
  }
}

function printSelectionReport(albumsMap, selectedAlbumKeys, skipped) {
  const rows = selectedAlbumKeys
    .map((k) => ({ key: k, title: albumsMap.get(k).title, count: albumsMap.get(k).items.length }))
    .sort((a, b) => b.count - a.count)
  console.log('\nAlbum breakdown (dry run — nothing converted):')
  for (const r of rows) {
    console.log(`  ${r.key.padEnd(28)} ${String(r.count).padStart(4)}  ${r.title}`)
  }
  console.log('\nSkip counters:')
  for (const [k, v] of Object.entries(skipped)) console.log(`  ${k}: ${v}`)
}

function printFinalReport(albumsOut, totals, skipped, convertFailures) {
  console.log('\n=== REPORT ===')
  console.log('\nAlbums:')
  for (const a of albumsOut) {
    console.log(`  ${a.key.padEnd(28)} ${String(a.count).padStart(4)}  ${a.title}`)
  }
  console.log(`\nTotal albums: ${totals.albums}`)
  console.log(`Total photos: ${totals.photos}`)
  const srcMB = totals.sourceBytes / (1024 * 1024)
  const outMB = totals.outputBytes / (1024 * 1024)
  const pct = totals.sourceBytes > 0 ? (100 - (totals.outputBytes * 100) / totals.sourceBytes) : 0
  console.log(`Source: ${srcMB.toFixed(1)} MB -> Output: ${outMB.toFixed(1)} MB  (${pct.toFixed(1)}% saved)`)
  console.log('\nSkip counters:')
  for (const [k, v] of Object.entries(skipped)) console.log(`  ${k}: ${v}`)
  if (convertFailures.length) {
    console.log('\nConversion failures:')
    for (const f of convertFailures) console.log(`  ${f.path}: ${f.error}`)
  } else {
    console.log('\nNo conversion failures.')
  }
  console.log(`\nCatalogue: ${OUT_JSON}`)
  console.log(`Staged images: ${OUT_IMAGES_ROOT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
