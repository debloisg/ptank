// Recodes the imported archive ARTICLE images to WebP and rewrites every
// reference to them in content/archives/**.md.
//
// WHY THIS EXISTS
// The site serves images straight from R2 with no edge resizing (see the `image`
// block in nuxt.config.ts) — Cloudflare bills Image Transformations per unique
// transformation per calendar month regardless of cache status, so caching cannot
// help and only emitting fewer transformed URLs can. That means whatever sits in
// the bucket is exactly what the browser downloads, so it has to be the right
// size already.
//
// These images came out of a 2008-era Joomla site: 1311 files, 207 MB, with 289
// of them over 200 KB accounting for 142 MB. They are not oversized in PIXELS
// (the heavy ones are ~800-1024px wide, about what the article column renders at)
// — they are just heavy JPEG/PNG. So the win is the codec, not the geometry:
// re-encoding the 60 heaviest to WebP measured 90% smaller, 919 KB average down
// to 92 KB. A generous 1400px cap only catches the few genuine outliers.
//
// Sibling to scripts/generate-galerie-tiles.mjs, which does the equivalent job
// for the photo gallery. That one writes a separate `tile` file because a gallery
// grid wants a much smaller image than its lightbox; here there is only one size,
// so the original is replaced outright and the markdown updated to match.
//
// Idempotent: an already-converted image whose markdown no longer references the
// old extension is skipped, so a rerun is cheap and produces no diff.
//
// Run BEFORE ./scripts/upload-archive-import-to-r2.sh, which uploads whatever is
// staged in .archive-import/images/. The superseded .jpg/.png objects already in
// R2 are NOT deleted by this script — see --prune-remote below for the command to
// clean them up once the deploy is verified.
//
// Usage:
//   node scripts/optimize-archive-images.mjs --dry-run
//   node scripts/optimize-archive-images.mjs
//   node scripts/optimize-archive-images.mjs --jobs=16
//   node scripts/optimize-archive-images.mjs --prune-remote   # print cleanup keys

import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_BASE = process.env.ARCHIVE_IMPORT_OUT_DIR
  ? path.resolve(process.env.ARCHIVE_IMPORT_OUT_DIR)
  : path.join(ROOT, '.archive-import')
const CONTENT_ROOT = path.join(ROOT, 'content', 'archives')
const CATALOGUE = path.join(OUT_BASE, 'galerie.json')

// BOTH trees, because both are served raw. The article images are referenced from
// markdown, the gallery photos from galerie.json — different bookkeeping, but the
// same job: whatever is in the bucket is exactly what the browser downloads, so it
// has to be the right size and codec already.
//
// ONE file per photo, deliberately. An earlier pass also built 400px thumbnails
// for the gallery grid; they were dropped. These photos came off a 2008-era site
// and are 680px wide at the median, so a thumbnail saved only 46% — and cost a
// second file per photo, a `tile` field threaded through the schema, catalogue,
// types and every call site. It also made the grid and the lightbox download
// DIFFERENT files: 33 KB + 60 KB for any photo someone opened, against 47 KB once
// when the grid image is the lightbox image already warm in cache.
const IMAGE_ROOTS = [
  path.join(OUT_BASE, 'images', 'archives'),
  path.join(OUT_BASE, 'images', 'galerie'),
]

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const PRUNE_REMOTE = args.includes('--prune-remote')
const JOBS = Number(args.find(a => a.startsWith('--jobs='))?.split('=')[1] ?? 0)
  || Math.max(2, Math.min(16, os.cpus().length))

// Wide enough that nothing visible is lost — the article column renders at ~700px
// and the heaviest sources are already ~800-1024px, so this only trims true
// outliers. `>` keeps it shrink-only.
const MAX_EDGE = 1400
// q72 rather than the usual q80. There is no separate thumbnail: a gallery grid
// cell and an article's full-width image are the SAME file, so this single
// setting has to serve both. Measured on 100 gallery photos, q72 is 47 KB against
// 60 KB at q80 — a 12-photo viewport drops 723 KB to 568 KB. Below ~q72 the curve
// flattens (q65 saves only 4 KB more) while artefacts start showing on
// photographs, so this is the knee.
const QUALITY = 72

// GIFs are excluded on purpose: many are animated decorative dividers from the
// Joomla era, and ImageMagick would flatten them to a single frame. BMP is in the
// list for a single 710 KB file the Joomla dump left behind — uncompressed, and
// by some margin the heaviest thing in the corpus.
const CONVERTIBLE = /\.(jpe?g|png|bmp)$/i

/** Every file under .archive-import/images/archives, recursively. */
async function walk(dir) {
  const out = []
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  }
  catch (err) {
    if (err.code !== 'ENOENT') throw err
    // Root not staged (e.g. an article-only rerun without the galerie tree) —
    // same tolerance the catalogue read has below.
    return out
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(abs))
    else out.push(abs)
  }
  return out
}

/** `/images/archives/...` path the markdown uses for a local file. */
function publicPath(abs) {
  return `/${path.relative(OUT_BASE, abs).split(path.sep).join('/')}`
}

const all = (await Promise.all(IMAGE_ROOTS.map(walk))).flat()
const targets = all.filter(f => CONVERTIBLE.test(f))

// One output name per SOURCE, assigned up front so two sources can never write
// the same file. `foo.jpg` and `foo.png` in one directory both want `foo.webp`:
// the first in sort order (jpg before png) keeps the base name, later ones get
// `foo-2.webp`, `foo-3.webp`… — the same convention the photo importer uses for
// gallery filename clashes (voeux24_1-2.webp). Already-present .webp files count
// as taken, so a rerun cannot overwrite a previously converted neighbour either.
const taken = new Set(all.filter(f => /\.webp$/i.test(f)))
const outputFor = new Map()
for (const abs of [...targets].sort()) {
  const base = abs.replace(/\.[^.]+$/, '')
  let out = `${base}.webp`
  for (let n = 2; taken.has(out); n += 1) out = `${base}-${n}.webp`
  taken.add(out)
  outputFor.set(abs, out)
}

console.log(
  `${targets.length} convertible image(s) of ${all.length} total · `
  + `${JOBS} parallel job(s)${DRY_RUN ? ' · DRY RUN' : ''}`,
)

let beforeBytes = 0
let afterBytes = 0
let converted = 0
const failures = []
/** old public path → new public path, for the markdown rewrite. */
const renames = new Map()

async function convertOne(abs) {
  const outAbs = outputFor.get(abs)
  try {
    const before = (await fs.stat(abs)).size
    if (!DRY_RUN) {
      await execFileP('magick', [
        abs,
        '-auto-orient',
        '-background', 'white',
        '-alpha', 'remove',
        '-alpha', 'off',
        '-resize', `${MAX_EDGE}x${MAX_EDGE}>`,
        '-strip',
        '-quality', String(QUALITY),
        outAbs,
      ])
    }
    // A dry run never encodes, so the output size — and with it the keep-original
    // guard below — is unknowable; it reports source bytes only.
    const after = DRY_RUN ? null : (await fs.stat(outAbs)).size

    // Guard against the pathological case: a tiny already-optimised source that
    // WebP makes bigger. Keep whichever is smaller, and only rewrite the markdown
    // when the file actually changed.
    if (!DRY_RUN && after >= before) {
      await fs.rm(outAbs, { force: true })
      return
    }

    renames.set(publicPath(abs), publicPath(outAbs))
    if (!DRY_RUN) await fs.rm(abs)
    beforeBytes += before
    if (!DRY_RUN) afterBytes += after
    converted += 1
  }
  catch (err) {
    failures.push({ file: publicPath(abs), error: err.message || String(err) })
  }
}

let cursor = 0
async function worker() {
  while (cursor < targets.length) {
    const abs = targets[cursor++]
    await convertOne(abs)
    if (cursor % 200 === 0) process.stdout.write(`  ${cursor}/${targets.length}\n`)
  }
}
await Promise.all(Array.from({ length: Math.min(JOBS, targets.length) }, worker))

// ── Rewrite the markdown ────────────────────────────────────────────────────
// Plain string replacement over the raw file rather than an AST pass: the paths
// are unique, unambiguous strings, and rewriting the markdown through a parser
// would reflow formatting the importer deliberately preserved.
async function markdownFiles(dir) {
  const out = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await markdownFiles(abs))
    else if (entry.name.endsWith('.md')) out.push(abs)
  }
  return out
}

let filesTouched = 0
let refsRewritten = 0
const mdFiles = await markdownFiles(CONTENT_ROOT)

for (const file of mdFiles) {
  const original = await fs.readFile(file, 'utf8')
  let next = original
  for (const [from, to] of renames) {
    if (!next.includes(from)) continue
    // Split/join rather than a regex: these paths contain characters that are
    // regex-significant, and escaping them is more error-prone than not needing to.
    const parts = next.split(from)
    refsRewritten += parts.length - 1
    next = parts.join(to)
  }
  if (next !== original) {
    filesTouched += 1
    if (!DRY_RUN) await fs.writeFile(file, next, 'utf8')
  }
}

// ── Rewrite the gallery catalogue ───────────────────────────────────────────
// The gallery's `src`/`cover` are bookkeeping in galerie.json rather than
// references in markdown, but they point at the same files and need the same
// extension fix. `tile` is untouched: those are already .400.webp.
//
// Deep links survive this. photoDomId() (app/utils/gallery.ts) derives a photo's
// DOM id from its filename with the extension stripped, so `#photo-foo` still
// resolves after foo.jpg becomes foo.webp.
let catalogueRefs = 0
try {
  const catalogue = JSON.parse(await fs.readFile(CATALOGUE, 'utf8'))
  for (const album of catalogue.albums) {
    if (renames.has(album.cover)) {
      album.cover = renames.get(album.cover)
      catalogueRefs += 1
    }
    for (const photo of album.photos) {
      if (renames.has(photo.src)) {
        photo.src = renames.get(photo.src)
        catalogueRefs += 1
      }
    }
  }
  if (!DRY_RUN && catalogueRefs > 0) {
    await fs.writeFile(CATALOGUE, `${JSON.stringify(catalogue, null, 2)}\n`, 'utf8')
  }
}
catch (err) {
  if (err.code !== 'ENOENT') throw err
  // No catalogue staged (e.g. an article-only rerun) — nothing to rewrite.
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`)
  for (const f of failures.slice(0, 20)) console.error(`  ${f.file}: ${f.error}`)
}

const mb = n => (n / 1048576).toFixed(1)
console.log(
  DRY_RUN
    ? `\nWould convert ${converted} image(s) totalling ${mb(beforeBytes)} MB `
      + `(output size unknown until a real run — a few tiny sources may be kept as-is)\n`
      + `Would rewrite ${refsRewritten} reference(s) across ${filesTouched} markdown file(s)`
      + `, and ${catalogueRefs} in galerie.json.`
    : `\nConverted ${converted} image(s): `
      + `${mb(beforeBytes)} MB → ${mb(afterBytes)} MB `
      + `(${beforeBytes > 0 ? Math.round(100 - (afterBytes * 100) / beforeBytes) : 0}% smaller)\n`
      + `Rewrote ${refsRewritten} reference(s) across ${filesTouched} markdown file(s)`
      + `, and ${catalogueRefs} in galerie.json.`,
)

// The converting run deletes the local .jpg/.png sources, so it is the only
// moment the superseded R2 keys are knowable. Persist them; --prune-remote runs
// standalone later, after the deploy is verified.
const PRUNE_FILE = path.join(OUT_BASE, 'superseded-r2-keys.txt')
if (!DRY_RUN && renames.size > 0) {
  const keys = [...renames.keys()].map(from => `images${from.replace(/^\/images/, '')}`)
  let existing = ''
  try {
    existing = await fs.readFile(PRUNE_FILE, 'utf8')
  }
  catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  const merged = [...new Set([...existing.split('\n').filter(Boolean), ...keys])]
  await fs.writeFile(PRUNE_FILE, `${merged.join('\n')}\n`, 'utf8')
  console.log(`\nRecorded ${keys.length} superseded R2 key(s) in ${path.relative(ROOT, PRUNE_FILE)}.`)
}

if (PRUNE_REMOTE) {
  // The uploader only ever PUTs, so the superseded .jpg/.png objects linger in
  // R2. Harmless (nothing references them) but they keep paying storage. Emitted
  // rather than executed: deleting from the live bucket should be a deliberate
  // step after the deploy is verified.
  let recorded = ''
  try {
    recorded = await fs.readFile(PRUNE_FILE, 'utf8')
  }
  catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  const keys = new Set(recorded.split('\n').filter(Boolean))
  if (keys.size === 0) {
    console.log('\nNo superseded R2 keys recorded — nothing to prune.')
  }
  else {
    console.log('\nSuperseded R2 keys — delete AFTER verifying the deploy:')
    for (const key of keys) console.log(`  ${key}`)
  }
}

if (!DRY_RUN && converted > 0) {
  console.log('\nNext: ./scripts/upload-archive-import-to-r2.sh')
}

process.exit(failures.length ? 1 : 0)
