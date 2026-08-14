// Generates the two derived files every site image gets alongside its base:
//
//   foo.webp  ->  foo-800.webp   800px-wide rendition for srcset (byte-copy when
//                                the base is already <=800px wide — the point is
//                                that the name EXISTS, so the @nuxt/image provider
//                                can be a pure string mapping with no metadata
//                                and no 404 risk)
//                 foo-ph.webp    ~24px blurred placeholder (~300 B) shown while
//                                the real file loads
//
// WHY: the site serves images raw from R2 with no edge transforms (billing — see
// nuxt.config.ts `image` block). srcset and blur-up placeholders therefore need
// their files pre-generated. This script covers the existing corpus; future
// Studio uploads get the same three objects generated server-side at upload time
// (see server/routes/__nuxt_studio/medias/[...path].put.ts).
//
// Inputs (never modified):
//   .archive-import/images/**   .webp and .png   (archive + galerie corpus; the
//                                4 .png are referenced as .png from galerie.json)
//   image-sources/**            .webp only       (curated masters; their .jpg
//                                siblings are sources, not served)
// GIFs are deliberately excluded: animated dividers/blasons that the provider
// serves verbatim.
//
// Output is staged in .image-variants/images/** mirroring the R2 key layout —
// NOT next to the sources — so the upload pass targets exactly the new objects
// and image-sources (Git LFS) doesn't grow derived files.
//
// Idempotent: existing outputs are skipped. Run with --force to regenerate.
//
// Usage:
//   node scripts/generate-image-variants.mjs --dry-run
//   node scripts/generate-image-variants.mjs
//   node scripts/generate-image-variants.mjs --jobs=16 --force
//
// Upload afterwards with: ./scripts/upload-image-variants-to-r2.sh

import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_BASE = path.join(ROOT, '.image-variants')

// [source root on disk, R2 key prefix under images/, extensions to process]
const SOURCES = [
  { root: path.join(ROOT, '.archive-import', 'images'), exts: ['.webp', '.png'] },
  { root: path.join(ROOT, 'image-sources'), exts: ['.webp'] },
]

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const FORCE = args.includes('--force')
const JOBS = Number(args.find(a => a.startsWith('--jobs='))?.split('=')[1] ?? 0)
  || Math.max(2, Math.min(16, os.cpus().length))

// Matches the corpus encoding (q72-85 across the import scripts); at 800px the
// difference is invisible and re-encoding from the already-compressed base only
// happens for the minority of images wider than 800px.
const QUALITY_800 = 75
const QUALITY_PH = 40

async function walk(dir) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  }
  catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
  const files = await Promise.all(entries.map(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : path.join(dir, e.name)))
  return files.flat()
}

function stemOf(rel) {
  return rel.replace(/\.[^.]+$/, '')
}

async function exists(p) {
  return fs.access(p).then(() => true, () => false)
}

const jobs = []
for (const { root, exts } of SOURCES) {
  for (const abs of await walk(root)) {
    const ext = path.extname(abs).toLowerCase()
    if (!exts.includes(ext)) continue
    const rel = path.relative(root, abs)
    const stem = stemOf(rel)
    // Refuse to derive variants OF a variant if the script is ever re-pointed at
    // its own output.
    if (/-(?:800|ph)$/.test(stem)) continue
    jobs.push({
      abs,
      out800: path.join(OUT_BASE, 'images', `${stem}-800.webp`),
      outPh: path.join(OUT_BASE, 'images', `${stem}-ph.webp`),
      isWebp: ext === '.webp',
    })
  }
}

let made800 = 0
let copied800 = 0
let madePh = 0
let skipped = 0
let failed = 0

async function convertOne(job) {
  const [has800, hasPh] = await Promise.all([exists(job.out800), exists(job.outPh)])
  if (!FORCE && has800 && hasPh) {
    skipped += 1
    return
  }
  if (DRY_RUN) {
    made800 += 1
    madePh += 1
    return
  }
  await fs.mkdir(path.dirname(job.out800), { recursive: true })

  try {
    if (FORCE || !has800) {
      // `[0]` pins the first frame; `800>` shrinks to 800px wide only when wider.
      const { stdout } = await execFileP('magick', ['identify', '-format', '%w', `${job.abs}[0]`])
      if (job.isWebp && Number(stdout) <= 800) {
        // Base already renders the 800 slot: byte-copy, zero generation loss.
        await fs.copyFile(job.abs, job.out800)
        copied800 += 1
      }
      else {
        await execFileP('magick', [`${job.abs}[0]`, '-auto-orient', '-resize', '800>', '-strip', '-quality', String(QUALITY_800), job.out800])
        made800 += 1
      }
    }
    if (FORCE || !hasPh) {
      await execFileP('magick', [`${job.abs}[0]`, '-auto-orient', '-thumbnail', '24>', '-strip', '-quality', String(QUALITY_PH), job.outPh])
      madePh += 1
    }
  }
  catch (err) {
    failed += 1
    console.error(`FAIL ${job.abs}: ${err.message}`)
  }
}

let cursor = 0
async function worker() {
  while (cursor < jobs.length) {
    const job = jobs[cursor]
    cursor += 1
    await convertOne(job)
  }
}

console.log(`${jobs.length} base image(s), ${JOBS} jobs${DRY_RUN ? ' (dry-run)' : ''}`)
await Promise.all(Array.from({ length: Math.min(JOBS, jobs.length) }, worker))

console.log([
  DRY_RUN ? `would generate variants for ${made800} image(s)` : `encoded ${made800} x -800`,
  DRY_RUN ? null : `copied ${copied800} x -800 (base <=800px)`,
  DRY_RUN ? null : `encoded ${madePh} x -ph`,
  `skipped ${skipped} already done`,
  failed ? `FAILED ${failed}` : null,
].filter(Boolean).join(', '))

if (failed) process.exit(1)
