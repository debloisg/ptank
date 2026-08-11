#!/usr/bin/env node
// ---------------------------------------------------------------------------
// import-archives.mjs — ONE-TIME importer that converts the old Joomla site's
// backed-up articles into Nuxt Content markdown under content/archives/.
//
// WHY THIS EXISTS
//   The club's previous site (Joomla) was scraped/backed up to
//   ptank-sftp-backup/articles/<year>/<slug>-<joomlaId>/index.md — YAML
//   frontmatter + a `# Title` heading + a body that is raw Joomla WYSIWYG
//   HTML (decades of copy-pasted Word documents, hand-built <table> layouts,
//   <font>/<span> soup, etc.). This script is the one and only bridge from
//   that mess to clean Nuxt Content markdown. It is meant to be run a
//   handful of times while tuning the rules below, then once for real, then
//   deleted from muscle memory (though left in the repo for the record).
//
// WHAT IT DOES, IN ORDER
//   1. Walk the source tree, keep only `state: "published"` articles (244).
//   2. Compute the output slug (strip the trailing "-<joomlaId>" from the
//      source dir name; on a same-year slug collision, ALL colliding
//      articles keep the "-<joomlaId>" suffix instead).
//   3. Parse the frontmatter block by hand (no YAML lib needed — the source
//      is a flat, single-line, `key: "value"` shape) and re-emit a small,
//      fixed set of frontmatter keys for the new file.
//   4. Load the HTML body into a real DOM (jsdom) and scrub it:
//        - drop Microsoft Word XML/conditional-comment junk (it turns out to
//          always live inside a single top-level HTML comment, so removing
//          every Comment node kills 100% of it — verified against the whole
//          corpus before relying on it)
//        - unwrap purely presentational tags (font/span/div/u/center/...)
//        - strip presentational attributes
//        - rewrite/copy/drop <img src> per the three source buckets
//          (article-local, old-domain-recoverable-from-photo-tree, other)
//        - turn `<a href="files/...">` / Joomla `index.php?...` links into
//          plain text (the PDFs are not in the backup; the links are dead)
//        - hand-build every <table> into a normalized GFM pipe table (or
//          flatten it as pure layout, e.g. Joomla's classic 1x1 "centering"
//          tables) — turndown-plugin-gfm's table rule can't cope with
//          colspan/rowspan/multi-line cells/missing headers, all of which
//          are rampant here, so the normalization happens before turndown
//          ever sees a <table>.
//   5. Hand the scrubbed DOM to turndown (+ turndown-plugin-gfm for
//      strikethrough; the table plugin is registered too but never fires —
//      no <table> nodes survive step 4) and post-process the markdown
//      (blank-line collapsing, MDC-unsafe sequence escaping, stripping any
//      raw HTML tag turndown still let through).
//   6. Write content/archives/<year>/<slug>.md and stage local images under
//      .archive-import/images/archives/<year>/<slug>/ (a later, separate
//      step is responsible for resizing/optimizing and moving these into
//      wherever the site actually serves images from — this script only
//      stages originals, per the brief).
//   7. Run a battery of self-checks (file count, forbidden leftovers, image
//      reference/staging parity, frontmatter well-formedness) and print a
//      report.
//
// USAGE
//   node scripts/import-archives.mjs [--dry-run] [--only=<substring>]
//     --dry-run       convert + report, write nothing to disk
//     --only=<sub>     only process source article dirs whose name (or
//                      "<year>/<dirname>") includes <sub> — for fast
//                      iteration while tuning the rules above
//
// SAFE TO RE-RUN: content/archives/ and .archive-import/images/archives/ are
// wiped at the start of every run (dry-run wipes nothing, obviously).
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { JSDOM } from 'jsdom'
import TurndownService from 'turndown'
import { gfm as gfmPlugin } from 'turndown-plugin-gfm'

const execFileAsync = promisify(execFile)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const BACKUP_ROOT = path.resolve(REPO_ROOT, '..', 'ptank-sftp-backup')
const SOURCE_ARTICLES_DIR = path.join(BACKUP_ROOT, 'articles')
const SOURCE_PHOTOS_DIR = path.join(BACKUP_ROOT, 'photos')
const OUTPUT_CONTENT_DIR = path.join(REPO_ROOT, 'content', 'archives')
const STAGING_ROOT = path.join(REPO_ROOT, '.archive-import')
const STAGING_IMAGES_DIR = path.join(STAGING_ROOT, 'images', 'archives')

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').slice('--only='.length) || null

// ── Small utilities ─────────────────────────────────────────────────────────

/** Collapse internal whitespace runs to a single space and trim. */
function collapseWhitespace(s) {
  return s.replace(/\s+/g, ' ').trim()
}

/** Decode the small set of numeric/named HTML entities that can appear in
 * frontmatter scalar values (the body goes through a real HTML parser so it
 * doesn't need this — this is only for things like `metadesc`/`title` that
 * are read as raw text out of the YAML-ish frontmatter block). */
function decodeEntities(s) {
  const div = decodeEntities._doc || (decodeEntities._doc = new JSDOM('').window.document.createElement('div'))
  div.innerHTML = s
  return div.textContent
}

/** lowercase, strip diacritics, replace anything not [a-z0-9._-] with '-',
 * collapse repeats, preserve extension (extension falls out naturally since
 * it only contains safe chars already). */
function safeFilename(name) {
  let s = name.toLowerCase()
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  s = s.replace(/[^a-z0-9._-]/g, '-')
  s = s.replace(/-+/g, '-')
  s = s.replace(/^-+|-+$/g, '')
  return s || 'image'
}

/** Strip the trailing "-<joomlaId>" (or "-<joomlaId>-something", for the one
 * backup dir that has a manually appended "-bis") from a source dir name.
 * Falls back to the frontmatter `alias` field, then to the raw dir name. */
function stripJoomlaIdSuffix(dirName, joomlaId, alias) {
  const suffix = '-' + String(joomlaId)
  const idx = dirName.lastIndexOf(suffix)
  if (idx !== -1) {
    const rest = dirName.slice(idx + suffix.length)
    if (rest === '' || rest.startsWith('-')) return dirName.slice(0, idx)
  }
  if (alias) return alias
  return dirName
}

/** Minimal frontmatter parser for this corpus: flat `key: "value"` or
 * `key: value` lines, one per line, no nesting. Good enough — verified by
 * hand against a wide sample of source files. */
function parseFrontmatter(block) {
  const fm = {}
  for (const line of block.split('\n')) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/)
    if (!m) continue
    const key = m[1]
    let value = m[2].trim()
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1).replace(/\\"/g, '"')
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1).replace(/\\'/g, "'")
    }
    fm[key] = value
  }
  return fm
}

/** Serialize the fixed set of output frontmatter keys, in order, quoting
 * strings (double quotes, escaping embedded quotes/backslashes) and leaving
 * numbers/dates bare. Keys with an undefined value are omitted entirely. */
function serializeFrontmatter(fm) {
  const order = ['title', 'description', 'date', 'year', 'category', 'journal', 'image', 'joomlaId', 'hits']
  const lines = ['---']
  for (const key of order) {
    const value = fm[key]
    if (value === undefined || value === null || value === '') continue
    if (typeof value === 'number') {
      lines.push(`${key}: ${value}`)
    } else if (key === 'date') {
      lines.push(`${key}: ${value}`)
    } else {
      const escaped = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      lines.push(`${key}: "${escaped}"`)
    }
  }
  lines.push('---')
  return lines.join('\n')
}

// ── Report accumulator ──────────────────────────────────────────────────────
const report = {
  converted: 0,
  perYear: {},
  tablesKept: 0,
  tablesUnwrapped: 0,
  imagesRewrittenLocal: 0,
  imagesRecoveredFromPhotos: 0,
  imagesDroppedMissing: 0,
  imagesDroppedExternal: 0,
  filesLinksFlattened: 0,
  ownDomainLinksFlattened: 0,
  emptyLinksRemoved: 0,
  unresolvableAnchorLinksDropped: 0,
  slugCollisionsResolved: 0,
  emptyBodyArticles: [],
  strippedTagCounts: new Map(),
  decorativeHeadingBarsFixed: 0,
  decorativeHeadingBarsDroppedAtBoundary: 0,
  imageOnlyHeadingsUnwrapped: 0,
  imageHeadingsWithTextSplit: 0,
  headingLinesRemapped: 0,
  filesWithHeadingLevelsRemapped: 0,
  headingsKept: 0,
  headingsDemotedLength: 0,
  headingsDemotedTerminalPunct: 0,
  headingsDemotedMultiSentence: 0,
  headingsDemotedLetterless: 0,
  headingsDroppedLetterlessEmpty: 0,
  headingRunsCollapsed: 0,
  headingsLostToRuns: 0,
  listItemsCreatedFromRuns: 0,
  bareOwnDomainUrlsRemoved: 0,
  imagesWithWidthAndHeight: 0,
  imagesWithWidthOnly: 0,
  imagesSizeFromHtml: 0,
  imagesSizeFromFile: 0,
  imagesSizeCapped: 0,
  imagesNoDimsAvailable: 0,
}

function bumpStrippedTag(tagName) {
  const key = tagName.toLowerCase()
  report.strippedTagCounts.set(key, (report.strippedTagCounts.get(key) || 0) + 1)
}

// ── Discover published articles ─────────────────────────────────────────────
function discoverArticles() {
  const years = readdirSync(SOURCE_ARTICLES_DIR).filter((y) => statSync(path.join(SOURCE_ARTICLES_DIR, y)).isDirectory())
  const articles = []
  for (const year of years.sort()) {
    const yearDir = path.join(SOURCE_ARTICLES_DIR, year)
    const dirs = readdirSync(yearDir).filter((d) => statSync(path.join(yearDir, d)).isDirectory())
    for (const dirName of dirs.sort()) {
      const indexPath = path.join(yearDir, dirName, 'index.md')
      if (!existsSync(indexPath)) continue
      if (ONLY && !dirName.includes(ONLY) && !`${year}/${dirName}`.includes(ONLY)) continue
      const raw = readFileSync(indexPath, 'utf8')
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
      if (!fmMatch) continue
      const fm = parseFrontmatter(fmMatch[1])
      if (fm.state !== 'published') continue
      articles.push({
        year,
        dirName,
        articleDir: path.join(yearDir, dirName),
        fm,
        bodyRaw: fmMatch[2],
      })
    }
  }
  return articles
}

// ── Slug resolution (with same-year collision handling) ────────────────────
function resolveSlugs(articles) {
  const candidateBySlugYear = new Map()
  for (const article of articles) {
    const candidate = stripJoomlaIdSuffix(article.dirName, article.fm.joomla_id, article.fm.alias)
    article.slugCandidate = candidate
    const key = `${article.year}::${candidate}`
    if (!candidateBySlugYear.has(key)) candidateBySlugYear.set(key, [])
    candidateBySlugYear.get(key).push(article)
  }
  for (const group of candidateBySlugYear.values()) {
    if (group.length === 1) {
      group[0].slug = group[0].slugCandidate
    } else {
      report.slugCollisionsResolved += group.length
      for (const article of group) {
        article.slug = `${article.slugCandidate}-${article.fm.joomla_id}`
      }
    }
  }
  return articles
}

// ── Image handling ──────────────────────────────────────────────────────────
const OWN_DOMAIN_RE = /^https?:\/\/(www\.)?petanque-?fouesnantaise\.fr\/images\/(.+)$/i

// Any absolute link (regardless of path, including the bare domain root)
// whose host is the club's OLD Joomla domain — with or without "www.", with
// or without the hyphen. These are guaranteed 404s on the new site (old
// Joomla taxonomy, e.g. "/index.php/fr/competitions/..."), and we never try
// to guess a mapping onto a current route — see processLinks().
const OWN_DOMAIN_LINK_RE = /^https?:\/\/(www\.)?petanque-?fouesnantaise\.fr(?:[/?#]|$)/i

/**
 * Resolve one <img>'s raw src to the absolute source file it would be copied
 * from, per the same bucket rules resolveImage() uses to copy it (article-
 * local "images/<file>", or the club's old domain under /images/...).
 * Read-only (existsSync only) — does not mutate anything or copy files. Kept
 * as its own function so the image-dimensions pre-pass (which needs to know
 * which real files to run through ImageMagick, before any article is
 * actually converted) and resolveImage() itself can never disagree about
 * which file backs a given <img>.
 */
function computeImageSourceFile(rawSrc, ctx) {
  const localMatch = rawSrc.match(/^images\/([^/]+)$/)
  if (localMatch) {
    const sourceFile = path.join(ctx.articleDir, 'images', localMatch[1])
    return existsSync(sourceFile) ? sourceFile : null
  }
  const ownDomainMatch = rawSrc.match(OWN_DOMAIN_RE)
  if (ownDomainMatch) {
    const sourceFile = path.join(SOURCE_PHOTOS_DIR, ownDomainMatch[2])
    return existsSync(sourceFile) ? sourceFile : null
  }
  return null
}

// ── Display-size resolution for <img> ───────────────────────────────────────
// The old Joomla HTML carried the *display* size of an image as width=/
// height= attributes and/or inline style="width:…px;height:…px" — that is
// exactly the information Nuxt UI's ProseImg needs to avoid stretching a
// ~70px emblem to the full ~1100px article column (no `width` prop => its
// theme applies a hard `w-full`). We emit that size back out as MDC
// attribute syntax: `![alt](src){width="70" height="66"}`.
const MAX_DISPLAY_WIDTH = 1024

/** Parse the explicit *display width* (rule 1) the source HTML asked for, in
 * px. Inline style wins over the width= attribute when both are present
 * (CSS beats a presentational attribute in a real browser too). Percentage
 * widths and anything <= 1 are treated as "not specified" — round to the
 * nearest integer. Never reads/uses height: the correctness rule is that
 * height is always derived from the file's real aspect ratio, never trusted
 * from HTML (the old site has plenty of squashed images). */
function parseExplicitDisplayWidthPx(img) {
  const style = img.getAttribute('style') || ''
  // The negative lookbehind excludes "border-width:"/"max-width:"/
  // "min-width:" etc. — without it, "width" as a bare substring of those
  // other CSS properties would be mistaken for the display width (seen for
  // real in this corpus: `style="border-width: 2px; border-style: solid;"`
  // was being read as a 2px display width).
  const styleMatch = style.match(/(?<![\w-])width\s*:\s*([\d.]+)\s*px/i)
  if (styleMatch) {
    const v = Math.round(parseFloat(styleMatch[1]))
    if (v > 1) return v
  }
  const attr = img.getAttribute('width')
  if (attr) {
    const m = String(attr).trim().match(/^([\d.]+)\s*(?:px)?$/i)
    if (m) {
      const v = Math.round(parseFloat(m[1]))
      if (v > 1) return v
    }
  }
  return null
}

/**
 * Compute the {width, height} to emit for one image, given the display width
 * the HTML explicitly asked for (or null) and the file's real pixel
 * dimensions (or null if unreadable). Width comes from rule 1 (explicit)
 * else rule 2 (the real file's own width); height is always recomputed from
 * the REAL aspect ratio so a distorted legacy height= is never baked in; the
 * result is capped at MAX_DISPLAY_WIDTH (rescaling height to match). Returns
 * null only when neither an explicit width nor real dimensions are
 * available — nothing to emit. Bumps the report counters that the import
 * report/final summary need (with/without height, HTML- vs file-sourced,
 * capped) as a side effect.
 */
function computeDisplaySize(explicitWidth, real) {
  const sourcedFromHtml = explicitWidth != null
  let width = sourcedFromHtml ? explicitWidth : (real ? real.w : null)
  if (width == null) {
    report.imagesNoDimsAvailable++
    return null
  }
  width = Math.max(1, Math.round(width))
  let capped = false
  if (width > MAX_DISPLAY_WIDTH) {
    width = MAX_DISPLAY_WIDTH
    capped = true
  }
  let height = null
  if (real && real.w > 0 && real.h > 0) {
    height = Math.max(1, Math.round((width * real.h) / real.w))
  }
  report.imagesSizeCapped += capped ? 1 : 0
  if (sourcedFromHtml) report.imagesSizeFromHtml++
  else report.imagesSizeFromFile++
  if (height != null) report.imagesWithWidthAndHeight++
  else report.imagesWithWidthOnly++
  return { width, height }
}

// A temporary marker embedded *inside* the markdown image's parens (as part
// of the "src" text turndown interpolates), never outside them. That
// placement is deliberate: every later pass that treats `([^)]*)` as an
// opaque URL blob — most importantly the image-only-heading and
// image-only-block checks in finalizeMarkdown()/deriveDescription(), which
// require an image's line/block to contain *nothing but* `![alt](url)` — has
// to keep seeing one complete, ordinary-looking image, never one with extra
// trailing content outside the parens that would wrongly make it look like
// "an image plus text". The marker is only converted to the real MDC
// `{width=...}` attribute block, moved outside the parens, at the very end
// (resolveImageDimensionMarkers), which is also what sidesteps the
// escapeMdcUnsafeSequences conflict — see that function's own comment.
function attachDimensionMarker(img, destPath, size) {
  const marker = `@@MDCDIM@@${size.width}@@${size.height != null ? size.height : 'NONE'}@@`
  img.setAttribute('src', destPath + marker)
}

/** Undo attachDimensionMarker(): turn "@@MDCDIM@@W@@H@@<optional turndown
 * title part>)" into "<title part>){width="W" height="H"}" (height omitted
 * when H is "NONE"). Deliberately tolerant of trailing title text between
 * the marker and the closing paren — turndown's default image rule inserts
 * ` "title"` there when the source <img> has a title= attribute, which is
 * rare in this corpus but not impossible.
 *
 * MUST run after escapeMdcUnsafeSequences (i.e. after finalizeMarkdown()
 * has fully run): that pass escapes accidental "){"/"]{" sequences coming
 * from source prose via `.replace(/([\])])\{/g, '$1\\{')`. If this
 * substitution ran *before* escaping, the "){width=...}" we just
 * intentionally created would be caught by that same regex and mangled into
 * ")\{width=...}". Running it after means the literal "){" we produce here
 * was never on the page when the escaping pass looked — so it survives —
 * while a genuine "){" typed by hand in the original article text still
 * goes through escapeMdcUnsafeSequences untouched by us and gets escaped as
 * before. */
function resolveImageDimensionMarkers(markdown) {
  return markdown.replace(/@@MDCDIM@@(\d+)@@(\d+|NONE)@@([^)]*)\)/g, (match, w, h, titlePart) => {
    const attrs = h === 'NONE' ? `{width="${w}"}` : `{width="${w}" height="${h}"}`
    return `${titlePart})${attrs}`
  })
}

// ── Real image dimensions (ImageMagick v7, batched) ─────────────────────────
// ~1650+ distinct source images — spawning `magick identify` once per image
// serially would be needlessly slow. Batch many paths into each invocation
// (chunked well under ARG_MAX) and run a small pool of batches concurrently;
// fall back to one-file-at-a-time only for a batch that fails outright (one
// unreadable file aborts the whole `identify` invocation, not just its own
// line of output).
function chunkArray(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function identifyBatch(files) {
  const { stdout } = await execFileAsync(
    'magick',
    ['identify', '-format', '%w %h\n', ...files.map((f) => `${f}[0]`)],
    { maxBuffer: 64 * 1024 * 1024 },
  )
  const lines = stdout.split('\n').filter((l) => l.trim() !== '')
  if (lines.length !== files.length) {
    throw new Error(`identify line-count mismatch: got ${lines.length} lines for ${files.length} files`)
  }
  const map = new Map()
  for (let i = 0; i < files.length; i++) {
    const m = lines[i].trim().match(/^(\d+)\s+(\d+)$/)
    if (!m) throw new Error(`identify: unparseable output "${lines[i]}" for ${files[i]}`)
    map.set(files[i], { w: Number(m[1]), h: Number(m[2]) })
  }
  return map
}

async function identifyOne(file) {
  try {
    const { stdout } = await execFileAsync('magick', ['identify', '-format', '%w %h', `${file}[0]`])
    const m = stdout.trim().match(/^(\d+)\s+(\d+)$/)
    return m ? { w: Number(m[1]), h: Number(m[2]) } : null
  } catch {
    return null
  }
}

/** Same "%w %h" lookup as identifyOne(), but blocking — used only as a
 * last-resort fallback from inside the (synchronous) per-article conversion
 * pass, for the rare file the async pre-pass's regex-based src scan missed
 * (e.g. an entity-encoded src). Results are cached by the caller so this
 * never runs twice for the same file. */
function identifyOneSync(file) {
  try {
    const stdout = execFileSync('magick', ['identify', '-format', '%w %h', `${file}[0]`], { encoding: 'utf8' })
    const m = stdout.trim().match(/^(\d+)\s+(\d+)$/)
    return m ? { w: Number(m[1]), h: Number(m[2]) } : null
  } catch {
    return null
  }
}

/** Run up to `concurrency` invocations of `worker` at a time, in order. */
async function runPool(items, concurrency, worker) {
  let idx = 0
  async function runNext() {
    while (idx < items.length) {
      const i = idx++
      await worker(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runNext))
}

/**
 * Pre-pass: discover every real source file that some <img> in the corpus
 * might resolve to (bucket 1/2, existing files only — a best-effort regex
 * scan of the raw HTML, NOT the authoritative resolver; the authoritative
 * one is computeImageSourceFile(), called again per-article from inside
 * resolveImage()) and batch-identify all of them up front. Returns a
 * Map<absoluteSourceFile, {w,h}> that the per-article pass consults
 * synchronously; a miss (this scan is best-effort, so a miss is possible but
 * should be rare) falls back to identifyOneSync() for just that one file.
 */
async function buildImageDimsCache(articles) {
  const files = new Set()
  const srcRe = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
  for (const article of articles) {
    for (const m of article.bodyRaw.matchAll(srcRe)) {
      const rawSrc = (m[1] ?? m[2] ?? '').trim()
      const sourceFile = computeImageSourceFile(rawSrc, { articleDir: article.articleDir })
      if (sourceFile) files.add(sourceFile)
    }
  }
  const fileList = Array.from(files)
  const cache = new Map()
  const batches = chunkArray(fileList, 150)
  await runPool(batches, 8, async (batch) => {
    try {
      const result = await identifyBatch(batch)
      for (const [f, dims] of result) cache.set(f, dims)
    } catch {
      // One bad file aborts the whole batch — fall back to per-file so the
      // rest of the batch is still cached (rather than losing all of it).
      await runPool(batch, 4, async (f) => {
        const dims = await identifyOne(f)
        if (dims) cache.set(f, dims)
      })
    }
  })
  return cache
}

/**
 * Resolve one <img> element's src against the three source buckets described
 * in the brief. Mutates the element's src/alt in place when the image
 * survives, or removes the element (and returns null) when it's dropped.
 * Returns the new rewritten path (e.g. "/images/archives/2024/foo/bar.jpg")
 * when the image survives, else null.
 */
function resolveImage(img, ctx) {
  const rawSrc = img.getAttribute('src') || ''
  const title = ctx.title

  const setAlt = () => {
    let alt = (img.getAttribute('alt') || '').trim()
    // Some source <img>s carry the old absolute club-domain URL itself as
    // their alt text (e.g. alt="http://www.petanque-fouesnantaise.fr/…"),
    // presumably auto-filled by whatever originally imported the photo.
    // That's not real alt text, and it's also exactly the dead-URL pattern
    // this pass is elsewhere responsible for scrubbing — treat it as empty
    // so it falls back to the article title like any other missing alt.
    if (OWN_DOMAIN_LINK_RE.test(alt)) alt = ''
    img.setAttribute('alt', alt || title)
  }

  // Display size (width/height MDC attrs) is resolved the same way
  // regardless of which bucket the image came from.
  const applySize = (sourceFile, destPath) => {
    const explicitWidth = parseExplicitDisplayWidthPx(img)
    const real = ctx.getImageDims(sourceFile)
    const size = computeDisplaySize(explicitWidth, real)
    if (size) attachDimensionMarker(img, destPath, size)
    else img.setAttribute('src', destPath)
  }

  // Bucket 1: article-local image, "images/<file>" with no further slash.
  const localMatch = rawSrc.match(/^images\/([^/]+)$/)
  if (localMatch) {
    const sourceFile = path.join(ctx.articleDir, 'images', localMatch[1])
    if (existsSync(sourceFile)) {
      const safe = ctx.uniqueSafeFilename(localMatch[1])
      const destPath = `/images/archives/${ctx.year}/${ctx.slug}/${safe}`
      if (!ctx.dryRun) {
        const destFile = path.join(STAGING_IMAGES_DIR, ctx.year, ctx.slug, safe)
        mkdirSync(path.dirname(destFile), { recursive: true })
        copyFileSync(sourceFile, destFile)
      }
      applySize(sourceFile, destPath)
      setAlt()
      report.imagesRewrittenLocal++
      return destPath
    }
    report.imagesDroppedMissing++
    img.remove()
    return null
  }

  // Bucket 2: absolute URL on the club's own old domain, under /images/...
  const ownDomainMatch = rawSrc.match(OWN_DOMAIN_RE)
  if (ownDomainMatch) {
    const pathAfterImages = ownDomainMatch[2]
    const sourceFile = path.join(SOURCE_PHOTOS_DIR, pathAfterImages)
    if (existsSync(sourceFile)) {
      const safe = ctx.uniqueSafeFilename(path.basename(pathAfterImages))
      const destPath = `/images/archives/${ctx.year}/${ctx.slug}/${safe}`
      if (!ctx.dryRun) {
        const destFile = path.join(STAGING_IMAGES_DIR, ctx.year, ctx.slug, safe)
        mkdirSync(path.dirname(destFile), { recursive: true })
        copyFileSync(sourceFile, destFile)
      }
      applySize(sourceFile, destPath)
      setAlt()
      report.imagesRecoveredFromPhotos++
      return destPath
    }
    report.imagesDroppedMissing++
    img.remove()
    return null
  }

  // Bucket 3: anything else absolute (other hosts, file:///, data:) — drop.
  report.imagesDroppedExternal++
  img.remove()
  return null
}

// ── Turndown setup ───────────────────────────────────────────────────────────
function createTurndownService() {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
    strongDelimiter: '**',
    hr: '---',
  })
  td.use(gfmPlugin)
  return td
}

// ── Table normalization (runs entirely in the DOM, before turndown) ────────
let tablePlaceholderCounter = 0
const tablePlaceholders = new Map() // token -> markdown

function cellColspan(cell) {
  const n = parseInt(cell.getAttribute('colspan') || '1', 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

function cellToInlineMarkdown(td, cell) {
  const html = cell.innerHTML
  if (!html || !html.trim()) return ''
  let md = td.turndown(html)
  md = md.replace(/\r\n?/g, '\n')
  md = md.replace(/\n+/g, '<br>')
  md = collapseWhitespace(md)
  md = md.replace(/\|/g, '\\|')
  return md.trim()
}

function buildPipeTableMarkdown(td, table) {
  const rows = Array.from(table.rows)
  if (rows.length === 0) return ''

  const grid = rows.map((row) => {
    const out = []
    for (const cell of Array.from(row.cells)) {
      const content = cellToInlineMarkdown(td, cell)
      const span = cellColspan(cell)
      out.push(content)
      for (let i = 1; i < span; i++) out.push('')
    }
    return out
  })

  const maxCols = Math.max(...grid.map((r) => r.length), 1)
  for (const row of grid) {
    while (row.length < maxCols) row.push('')
  }

  const header = grid[0]
  const bodyRows = grid.slice(1)

  const renderRow = (cells) => `| ${cells.map((c) => c || '').join(' | ')} |`
  const lines = [renderRow(header), renderRow(header.map(() => '---'))]
  for (const row of bodyRows) lines.push(renderRow(row))
  return lines.join('\n')
}

/**
 * A table is "layout" (Joomla's classic centering trick, or a table nested
 * inside another table's cell — GFM has no notion of nested tables so any
 * such table is always flattened, regardless of its own shape) when it has
 * exactly one row, exactly one column, or an ancestor <table>.
 */
function isLayoutTable(table) {
  const rows = Array.from(table.rows)
  if (rows.length <= 1) return true
  const maxCols = Math.max(...rows.map((r) => Array.from(r.cells).reduce((sum, c) => sum + cellColspan(c), 0)), 0)
  if (maxCols <= 1) return true
  if (table.parentElement && table.parentElement.closest('table')) return true
  return false
}

function unwrapLayoutTable(table) {
  const doc = table.ownerDocument
  const frag = doc.createDocumentFragment()
  for (const row of Array.from(table.rows)) {
    for (const cell of Array.from(row.cells)) {
      while (cell.firstChild) frag.appendChild(cell.firstChild)
    }
  }
  table.replaceWith(frag)
}

function convertDataTable(td, table) {
  const markdown = buildPipeTableMarkdown(td, table)
  tablePlaceholderCounter++
  const token = `TABLEPLACEHOLDERXYZ${tablePlaceholderCounter}`
  tablePlaceholders.set(token, markdown)
  const doc = table.ownerDocument
  const p = doc.createElement('p')
  p.textContent = token
  table.replaceWith(p)
}

function processTables(td, root) {
  // Reverse document order so nested tables are resolved before their
  // ancestor (isLayoutTable's "nested table" check relies on this: by the
  // time we look at an outer table, any inner table has already been
  // replaced by plain content or a placeholder paragraph).
  const tables = Array.from(root.querySelectorAll('table')).reverse()
  for (const table of tables) {
    if (isLayoutTable(table)) {
      report.tablesUnwrapped++
      unwrapLayoutTable(table)
    } else {
      report.tablesKept++
      convertDataTable(td, table)
    }
  }
}

// ── Link handling ────────────────────────────────────────────────────────────
function processLinks(root) {
  for (const a of Array.from(root.querySelectorAll('a'))) {
    const href = a.getAttribute('href') || ''
    if (/^files\//i.test(href) || /^index\.php/i.test(href)) {
      const text = a.textContent
      a.replaceWith(a.ownerDocument.createTextNode(text))
      report.filesLinksFlattened++
    } else if (OWN_DOMAIN_LINK_RE.test(href)) {
      // Dead Joomla URL on the club's own domain (old taxonomy, e.g.
      // "/index.php/fr/competitions/..."), whether http or https, with or
      // without "www." — never guess a mapping onto a current route, just
      // drop the anchor and keep the label, exactly like a files/* link.
      const text = a.textContent
      a.replaceWith(a.ownerDocument.createTextNode(text))
      report.ownDomainLinksFlattened++
    }
    // mailto: / absolute http(s) links to OTHER hosts are left as-is.
  }
}

/**
 * Remove any <a> left with no real content: empty/whitespace-only text and
 * no surviving <img> inside (an <a> that still wraps a kept image — e.g. a
 * photo that links out to another site — is a real, intentional link and
 * must be left alone; textContent alone can't tell the two apart since an
 * <img> contributes nothing to textContent).
 *
 * Two sources feed this, both from the corpus, not from anything else in
 * this script: bare Joomla in-page anchors (`<a href="#_1"></a>`, left
 * behind by Word-pasted footnote markup with no visible label) and an <a>
 * whose only child was an <img> that resolveImage() went on to drop (dead
 * external src, or a missing local file) — the second case is why this must
 * run AFTER the image-resolution loop, not before.
 */
function removeEmptyLinks(root) {
  for (const a of Array.from(root.querySelectorAll('a'))) {
    if (a.querySelector('img')) continue
    if (collapseWhitespace(a.textContent) === '') {
      a.remove()
      report.emptyLinksRemoved++
    }
  }
}

// ── Presentational-tag unwrapping / attribute stripping / cleanup ──────────
const UNWRAP_TAGS = ['font', 'span', 'u', 'div', 'header', 'center', 'big', 'small', 'basefont']
const STRIP_ATTRS = [
  'style', 'class', 'id', 'lang', 'dir', 'align', 'valign', 'bgcolor',
  'border', 'cellpadding', 'cellspacing', 'width', 'height',
]
const EMPTY_REMOVABLE_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 'li'])

function unwrapPresentationalTags(root) {
  const els = Array.from(root.querySelectorAll(UNWRAP_TAGS.join(',')))
  for (const el of els) {
    const frag = el.ownerDocument.createDocumentFragment()
    while (el.firstChild) frag.appendChild(el.firstChild)
    el.replaceWith(frag)
  }
}

function removeWordJunkElements(root) {
  // Defensive: the whole corpus was verified to keep every <w:*>/<m:*>/<o:*>
  // tag inside a single HTML comment (already stripped), but strip any
  // stray ones directly too, just in case a future backup differs.
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase()
    if (/^[wmo]:/.test(tag) || tag === 'xml') el.remove()
  }
}

function stripAttributes(root) {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const attr of STRIP_ATTRS) el.removeAttribute(attr)
  }
}

function removeCommentsScriptsStyles(root) {
  const doc = root.ownerDocument
  const walker = doc.createTreeWalker(root, 128 /* NodeFilter.SHOW_COMMENT */)
  const comments = []
  let n
  while ((n = walker.nextNode())) comments.push(n)
  comments.forEach((c) => c.remove())
  for (const el of Array.from(root.querySelectorAll('script, style'))) el.remove()
}

function normalizeNbsp(root) {
  const doc = root.ownerDocument
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  const texts = []
  let n
  while ((n = walker.nextNode())) texts.push(n)
  for (const t of texts) {
    t.data = t.data.replace(/\u00a0/g, ' ').replace(/ {2,}/g, ' ')
  }
}

function removeEmptyElements(root) {
  // Run a few passes: removing an empty <strong> can leave its parent <p>
  // (or an empty <li>'s parent <ul>) empty too.
  for (let pass = 0; pass < 4; pass++) {
    let removedAny = false
    for (const el of Array.from(root.querySelectorAll(Array.from(EMPTY_REMOVABLE_TAGS).join(',')))) {
      if (el.querySelector('img')) continue
      if (collapseWhitespace(el.textContent) === '') {
        el.remove()
        removedAny = true
      }
    }
    for (const list of Array.from(root.querySelectorAll('ul, ol'))) {
      if (!list.querySelector('li')) {
        list.remove()
        removedAny = true
      }
    }
    if (!removedAny) break
  }
}

function dedupeConsecutiveImages(root) {
  const imgs = Array.from(root.querySelectorAll('img'))
  let lastSrc = null
  for (const img of imgs) {
    const src = img.getAttribute('src') || ''
    if (src && src === lastSrc) {
      const parent = img.parentElement
      img.remove()
      if (parent && parent !== root && collapseWhitespace(parent.textContent) === '' && !parent.querySelector('img')) {
        parent.remove()
      }
    } else {
      lastSrc = src
    }
  }
}

// ── Markdown post-processing ─────────────────────────────────────────────────
const MARKDOWN_TAG_ALLOWLIST = new Set(['br', 'strong', 'b', 'em', 'i', 'sup', 'sub', 'table', 'thead', 'tbody', 'tr', 'th', 'td'])

function substituteTablePlaceholders(markdown) {
  // A plain-string, token-by-token .replace() is unsafe here: e.g. the
  // token "TABLEPLACEHOLDERXYZ1" is a textual prefix of
  // "TABLEPLACEHOLDERXYZ10", "TABLEPLACEHOLDERXYZ11", etc. Replacing "…XYZ1"
  // first (Map insertion order) would eat the leading digits of a
  // *different*, not-yet-processed placeholder. A single regex pass that
  // captures the *whole* run of digits (`\d+`) has no such ambiguity.
  return markdown.replace(/TABLEPLACEHOLDERXYZ(\d+)/g, (match, n) => {
    const tableMd = tablePlaceholders.get(`TABLEPLACEHOLDERXYZ${n}`)
    return tableMd === undefined ? match : `\n${tableMd}\n`
  })
}

function stripDisallowedRawTags(markdown) {
  return markdown.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (match, tagName) => {
    if (MARKDOWN_TAG_ALLOWLIST.has(tagName.toLowerCase())) return match
    bumpStrippedTag(tagName)
    return ''
  })
}

function escapeMdcUnsafeSequences(markdown) {
  return markdown
    .split('\n')
    .map((line) => line.replace(/^(\s*)::/, '$1\\:\\:'))
    .join('\n')
    .replace(/([\])])\{/g, '$1\\{')
}

// A bare (not `[label](url)`-wrapped) URL to the club's own OLD Joomla
// domain, sitting directly in prose text. processLinks() already flattens
// every markdown-link form of a dead club-domain URL at the DOM level
// (before turndown ever runs) — this catches the separate case of someone
// having typed the URL itself as plain text, which turndown passes through
// untouched and GFM would then auto-link right back into a dead link at
// render time. Removed entirely (never left as text, which is exactly what
// GFM autolinking would re-break) rather than flattened.
// Excludes a URL immediately preceded by "(" or "[" (a real markdown link
// target, or — the bug this guard actually caught in testing — an image's
// alt text that happens to literally be the old absolute URL, e.g.
// `![http://www.petanque-fouesnantaise.fr/.../foo.jpg](...)`: without the
// "[" exclusion and without stopping the match at "]" too, this regex would
// eat straight through the alt text's closing "]" and the image's own
// "](/images/archives/...)" destination, corrupting the image markdown).
const BARE_OWN_DOMAIN_URL_RE = /[ \t]?(?<![([])https?:\/\/(?:www\.)?petanque-?fouesnantaise\.fr[^\s)\]]*[ \t]?/gi

function removeBareOwnDomainUrls(markdown) {
  return markdown.replace(BARE_OWN_DOMAIN_URL_RE, (match) => {
    report.bareOwnDomainUrlsRemoved++
    // A space captured on both sides (url sandwiched between two words)
    // collapses to one space; a space on only one side (url at the very
    // start/end of the surrounding text) is dropped along with the url so
    // no stray leading/trailing space is left behind.
    const leadingSpace = /^[ \t]/.test(match)
    const trailingSpace = /[ \t]$/.test(match)
    return leadingSpace && trailingSpace ? ' ' : ''
  })
}

function collapseBlankLines(markdown) {
  return markdown.replace(/\n{3,}/g, '\n\n')
}

// ── Heading cleanup (decorative bars / image-only headings / level remap) ──
// The old site typed rows of underscores/dashes/etc. inside <h1>-<h6> to draw
// horizontal rules, and wrapped bare <img>s in heading tags just to size
// them. Neither is a real heading. These three passes run on the finished
// markdown (after turndown + entity/tag cleanup) because "decorative" needs
// to be judged on the text turndown actually emitted (backslash-escaped),
// and level remapping needs the whole document's set of headings anyway.
const DECORATIVE_HEADING_CHARS_RE = /^[_=~.*·-]+$/
const MD_IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g
const MD_IMAGE_ONLY_LINE_RE = /^(?:!\[[^\]]*\]\([^)]*\)\s*)+$/
const HEADING_LINE_RE = /^(#{1,6})[ \t]+(.*)$/

/** Undo turndown's backslash-escaping of the small set of characters a
 * decorative bar is made of (turndown escapes plain-text "_", "*", leading
 * "-", digit-leading "." etc. so they can't be mistaken for markdown
 * syntax). Only unescapes chars in the decorative set — never touches
 * "\[", "\]" etc. so real escaped text elsewhere is untouched. */
function unescapeDecorativeChars(s) {
  return s.replace(/\\([_=~.*·-])/g, '$1')
}

function isDecorativeHeadingText(headingText) {
  const bare = unescapeDecorativeChars(headingText).replace(/\s+/g, '')
  // The "3+ chars" framing in the brief describes the typical case (a long
  // bar of underscores/dashes); a 1-2 char residue made solely of these
  // punctuation marks (e.g. a lone "." or "-" heading) carries exactly as
  // little information and must not survive as a heading either — the
  // no-decorative-bar-heading verification check has no length floor.
  return bare.length > 0 && DECORATIVE_HEADING_CHARS_RE.test(bare)
}

/** DEFECT 1: a heading that's just a decorative separator bar becomes a
 * thematic break on its own line (isolation/collapsing/boundary-dropping of
 * the resulting "---" lines happens later, once blank lines are settled). */
function fixDecorativeHeadingBars(markdown) {
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEADING_LINE_RE)
    if (!m) continue
    if (isDecorativeHeadingText(m[2])) {
      lines[i] = '---'
      report.decorativeHeadingBarsFixed++
    }
  }
  return lines.join('\n')
}

/** DEFECT 2: unwrap image-only headings to a plain paragraph; for headings
 * that mix an image with real text, hoist the image(s) to their own
 * paragraph immediately before the heading and leave the heading text-only. */
function fixHeadingsWithImages(markdown) {
  const lines = markdown.split('\n')
  const out = []
  for (const line of lines) {
    const m = line.match(HEADING_LINE_RE)
    if (!m) { out.push(line); continue }
    const [, hashes, content] = m
    const images = content.match(MD_IMAGE_RE)
    if (!images) { out.push(line); continue }
    const textOnly = content.replace(MD_IMAGE_RE, '').replace(/\s+/g, ' ').trim()
    if (textOnly === '') {
      out.push('', content.trim(), '')
      report.imageOnlyHeadingsUnwrapped++
    } else {
      out.push('', images.join(' '), '', `${hashes} ${textOnly}`)
      report.imageHeadingsWithTextSplit++
    }
  }
  return out.join('\n')
}

/** Strip markdown syntax down to plain visible text, for classifying a
 * heading's content: images gone (fixHeadingsWithImages already hoists any
 * real ones out before this runs, so this is just a defensive no-op most of
 * the time), link labels kept, emphasis/code markers and backslash-escapes
 * removed. Mirrors the same stripping deriveDescription() already does. */
function headingPlainText(content) {
  let text = content
  text = text.replace(/!\[[^\]]*\]\([^)]*\)(?:\{[^}]*\})?/g, '')
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  text = text.replace(/\\([*_`#\\])/g, '$1')
  text = text.replace(/[*_`#]/g, '')
  return collapseWhitespace(text)
}

/**
 * Classify a heading's raw content as a real heading or body text wrongly
 * marked up as one (the old Joomla site used h3/h4/h5 purely to make body
 * text big, not to structure the document). `evalText` is the plain text
 * with any LEADING emoji/punctuation stripped, per the brief's rule: the
 * length/sentence-boundary rules are judged on that, while "has no letters"
 * (defect 2 — a heading whose text is only digits/punctuation slugifies to
 * empty, so @nuxt/content's id fallback produces an anchor with no
 * accessible text) is judged on the full plain text, since a leading emoji
 * doesn't change whether there's a real letter *somewhere* in the heading.
 */
function classifyHeadingText(rawContent) {
  const plain = headingPlainText(rawContent)
  const hasLetter = /\p{L}/u.test(plain)
  const evalText = plain.replace(/^[^\p{L}\p{N}]+/u, '')

  // Rule 1 is also hard-guaranteed against the RAW (un-stripped) content
  // length: a heading built almost entirely out of a link (label wrapping a
  // long URL) or heavy `**`/`_` markup can have a short *rendered* label
  // while its raw line is still well past 120 — and the verification check
  // for this defect greps the raw line, not the rendered text, so either
  // form of "too long" must demote.
  if (evalText.length > 120 || rawContent.trim().length >= 120) {
    return { demote: true, reason: 'length', plain }
  }
  if (evalText.length > 60 && /[.!?…]$/.test(evalText)) {
    return { demote: true, reason: 'terminalPunct', plain }
  }
  const sentenceBoundaries = evalText.match(/[.!?…]\s+[\p{Lu}0-9]/gu) || []
  if (sentenceBoundaries.length >= 2) return { demote: true, reason: 'multiSentence', plain }
  if (!hasLetter) return { demote: true, reason: plain === '' ? 'letterlessEmpty' : 'letterless', plain }
  return { demote: false, reason: null, plain }
}

/** DEFECT (link checker + a11y): demote a heading whose content is actually
 * body text (paragraphs the old site typed as h3/h4/h5 for visual size) or
 * whose text has no letters at all (slugifies to empty, so @nuxt/content's
 * id fallback — "_1", "_2"… — leaves ProseH*'s anchor link with no
 * accessible text). "Demote" means drop the "#+ " prefix and emit the exact
 * same inline content as a plain paragraph line — no re-wrapping in `**`,
 * the old visual emphasis isn't worth carrying into semantics. A heading
 * that's letterless AND has no content left at all (extremely rare — most
 * such cases are already gone via the decorative-bar/image-only passes
 * above) is dropped outright instead of emitted as an empty paragraph.
 * Must run after fixHeadingsWithImages (so any real image is already
 * hoisted out) and after fixDecorativeHeadingBars (so a punctuation-only
 * bar became "---" already, rather than being reported as "letterless"
 * here), and before remapHeadingLevels (so demoted lines are never counted
 * as headings when picking the surviving levels). */
function demoteNonHeadings(markdown) {
  const lines = markdown.split('\n')
  const out = []
  for (const line of lines) {
    // A heading with NO content at all — not even a trailing space, so
    // HEADING_LINE_RE (which requires "#+" followed by whitespace) doesn't
    // even match it. Turndown produces this when a source heading's only
    // child was a <br> ahead of a sibling <span> that itself split into a
    // separate block: the <br> becomes a hard line break INSIDE the
    // heading's inline content, which severs the "#### " prefix from the
    // real text, leaving a bare, contentless heading line behind. Exactly
    // as letterless-and-empty as the digits-only case below — drop it.
    if (/^#{1,6}[ \t]*$/.test(line)) {
      report.headingsDroppedLetterlessEmpty++
      continue
    }
    const m = line.match(HEADING_LINE_RE)
    if (!m || m[2].trim() === '') { out.push(line); continue }
    const { demote, reason } = classifyHeadingText(m[2])
    if (!demote) {
      out.push(line)
      report.headingsKept++
      continue
    }
    if (reason === 'letterlessEmpty') {
      report.headingsDroppedLetterlessEmpty++
      continue
    }
    out.push(m[2])
    if (reason === 'length') report.headingsDemotedLength++
    else if (reason === 'terminalPunct') report.headingsDemotedTerminalPunct++
    else if (reason === 'multiSentence') report.headingsDemotedMultiSentence++
    else if (reason === 'letterless') report.headingsDemotedLetterless++
  }
  return out.join('\n')
}

/** Make sure every "---" thematic break line sits on its own line, isolated
 * by blank lines, so it can never be mistaken for a setext-heading
 * underline or run together with adjacent content. */
function ensureThematicBreakIsolated(markdown) {
  const lines = markdown.split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === '---') {
      if (out.length > 0 && out[out.length - 1].trim() !== '') out.push('')
      out.push('---')
      if (i + 1 < lines.length && lines[i + 1].trim() !== '') out.push('')
    } else {
      out.push(line)
    }
  }
  return out.join('\n')
}

/** Collapse runs of consecutive "---" blocks (separated only by blank
 * lines) down to one, then drop a "---" that ends up as the very first or
 * very last block of the document (a leading/trailing rule is just noise;
 * an interior one is a real section divider). Must run after blank-line
 * runs have already been normalized to exactly one blank line, so a
 * document is a clean sequence of "\n\n"-separated blocks. */
function collapseAndTrimThematicBreaks(markdown) {
  const blocks = markdown.split('\n\n')
  const collapsed = []
  for (const block of blocks) {
    const isBreak = block.trim() === '---'
    if (isBreak && collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === '---') continue
    collapsed.push(block)
  }
  while (collapsed.length > 0 && collapsed[0].trim() === '---') {
    collapsed.shift()
    report.decorativeHeadingBarsDroppedAtBoundary++
  }
  while (collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === '---') {
    collapsed.pop()
    report.decorativeHeadingBarsDroppedAtBoundary++
  }
  return collapsed.join('\n\n')
}

/**
 * The other half of the "old Joomla site abused heading tags" habit:
 * where demoteNonHeadings() catches a single paragraph wrongly marked up as
 * one heading, this catches a LIST wrongly marked up as a *run* of
 * consecutive headings — e.g. a competition results list where every place
 * ("1e Lafitte et Arnaud de Quimperlé", "2e ...", ...) got its own `<h3>`.
 * Operates on "\n\n"-separated blocks (must run after collapseBlankLines /
 * collapseAndTrimThematicBreaks have settled the document into a clean
 * block sequence, so "separated only by blank lines, with no other content
 * between them" is exactly "these blocks are consecutive array entries") —
 * any intervening paragraph/image/table/list/thematic-break block is
 * automatically its own array entry and breaks the run, no extra check
 * needed. Must run before remapHeadingLevels(), so the survivors (the
 * kept trailing-colon label headings, plus any run of only 1-2 that didn't
 * qualify) are what's left when levels get renormalized.
 */
function shortHeadingBlockInfo(block) {
  if (block.includes('\n')) return null // defensive: a real lone heading is always a single line
  const m = block.match(HEADING_LINE_RE)
  if (!m) return null
  const plain = headingPlainText(m[2])
  if (plain === '' || plain.length > 60) return null
  return { hashes: m[1], level: m[1].length, content: m[2] }
}

function collapseHeadingRuns(markdown) {
  const blocks = markdown.split('\n\n')
  const out = []
  let i = 0
  while (i < blocks.length) {
    const first = shortHeadingBlockInfo(blocks[i])
    if (!first) { out.push(blocks[i]); i++; continue }
    const run = [first]
    let j = i + 1
    while (j < blocks.length) {
      const next = shortHeadingBlockInfo(blocks[j])
      if (!next || next.level !== first.level) break
      run.push(next)
      j++
    }
    if (run.length < 3) { out.push(blocks[i]); i++; continue }

    report.headingRunsCollapsed++
    let items = run
    // A run whose first item ends in ":" is a label introducing the list
    // ("Les résultats : concours principal :") — keep it as the heading,
    // turn only the rest into bullets.
    if (/:\s*$/.test(headingPlainText(run[0].content))) {
      out.push(`${run[0].hashes} ${run[0].content}`)
      items = run.slice(1)
    }
    report.headingsLostToRuns += items.length
    report.listItemsCreatedFromRuns += items.length
    // A single contiguous "\n"-joined list (no blank lines between items)
    // so it parses as one list, not several.
    out.push(items.map((it) => `- ${it.content}`).join('\n'))
    i = j
  }
  return out.join('\n\n')
}

/** DEFECT 3: the article <h1>/page title already renders as the real page
 * H1, and the source used heading levels for visual sizing, not structure —
 * remap whatever distinct levels remain (in shallow-to-deep order) onto a
 * contiguous ##..###### run so the body never emits "#" and relative
 * nesting is preserved. */
function remapHeadingLevels(markdown) {
  const lines = markdown.split('\n')
  const levelsUsed = new Set()
  for (const line of lines) {
    const m = line.match(HEADING_LINE_RE)
    if (m && m[2].trim() !== '') levelsUsed.add(m[1].length)
  }
  const sortedLevels = Array.from(levelsUsed).sort((a, b) => a - b)
  const levelMap = new Map(sortedLevels.map((level, idx) => [level, Math.min(idx + 2, 6)]))

  let fileChanged = false
  const out = lines.map((line) => {
    const m = line.match(HEADING_LINE_RE)
    if (!m || m[2].trim() === '') return line
    const newLevel = levelMap.get(m[1].length)
    const newHashes = '#'.repeat(newLevel)
    if (newHashes.length !== m[1].length) {
      report.headingLinesRemapped++
      fileChanged = true
    }
    return `${newHashes} ${m[2]}`
  })
  if (fileChanged) report.filesWithHeadingLevelsRemapped++
  return out.join('\n')
}

function trimTrailingWhitespace(markdown) {
  return markdown
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
}

/** Approximate the slug a markdown-heading-id generator (rehype-slug /
 * github-slugger, which is what Nuxt Content's rendering pipeline uses)
 * would assign to a heading's text: lowercase, strip diacritics, drop
 * anything that isn't a letter/digit/space/hyphen, collapse whitespace to
 * single hyphens. Doesn't need to be byte-perfect — it only has to tell
 * whether some real heading could plausibly own a given `#anchor` target,
 * and the anchors in this corpus (bare Joomla/Word footnote markers like
 * "_1", "_ftn1") never coincide with real heading text either way. */
function slugifyHeadingText(text) {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 -]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

/** DEFECT (link checker): a markdown link to a bare in-page anchor
 * (`[label](#_1)`) whose target doesn't match any heading actually present
 * in the finalized document can never resolve — the old Joomla/Word anchor
 * names ("_1", "_ftn1"...) were never derived from heading text and nothing
 * in this pipeline preserves or re-creates them. Flatten to the label only
 * (same "keep the label, drop the dead target" treatment as files/* and
 * own-domain links) rather than leaving a link that 404s to nowhere. Must
 * run after remapHeadingLevels, once the document's real, final heading
 * text is settled. Only touches `[label](#target)` — the `(?<!!)` guard
 * keeps it away from `![alt](#target)` image syntax, though real images
 * never use a bare "#" src anyway. */
function dropUnresolvableAnchorLinks(markdown) {
  const headingSlugs = new Set()
  for (const line of markdown.split('\n')) {
    const m = line.match(HEADING_LINE_RE)
    if (!m) continue
    let text = m[2]
    text = text.replace(/!\[[^\]]*\]\([^)]*\)(?:\{[^}]*\})?/g, '')
    text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    text = text.replace(/\\([*_`#\\])/g, '$1')
    text = text.replace(/[*_`#]/g, '')
    headingSlugs.add(slugifyHeadingText(text.trim()))
  }
  return markdown.replace(/(?<!!)\[([^\]]+)\]\(#([^)\s]+)\)/g, (match, label, target) => {
    if (headingSlugs.has(decodeURIComponent(target).toLowerCase())) return match
    report.unresolvableAnchorLinksDropped++
    return label
  })
}

function finalizeMarkdown(markdown) {
  let md = substituteTablePlaceholders(markdown)
  md = stripDisallowedRawTags(md)
  md = escapeMdcUnsafeSequences(md)
  // Dead bare URLs to the club's own domain: remove before heading
  // classification runs, so a stray URL sitting inside a heading's text
  // never inflates it past the length-based demotion thresholds below.
  md = removeBareOwnDomainUrls(md)
  // Heading cleanup: unwrap image-only/image-leading headings first (so a
  // heading that turns out to have been "just an image" never gets tested
  // against the decorative-bar rule), then convert decorative separator
  // bars to thematic breaks, then demote any heading that's actually body
  // text (or has no letters at all) to a plain paragraph, then isolate
  // every remaining "---" with blank lines.
  md = fixHeadingsWithImages(md)
  md = fixDecorativeHeadingBars(md)
  md = demoteNonHeadings(md)
  md = ensureThematicBreakIsolated(md)
  // Trim BEFORE collapsing blank lines: a "blank" line that actually
  // contains only whitespace (e.g. left behind by an emptied-out nested
  // list) must become truly empty first, or a run of 3+ newlines with one
  // whitespace-only line in the middle won't be seen as collapsible.
  md = trimTrailingWhitespace(md)
  md = collapseBlankLines(md)
  // Now that blank-line runs are normalized to exactly one blank line, the
  // document is a clean "\n\n"-separated block sequence: collapse/trim
  // thematic breaks at the block level, collapse heading-runs-that-are-
  // really-lists, then remap heading levels (which must see the final,
  // post-collapse set of survivors).
  md = collapseAndTrimThematicBreaks(md)
  md = collapseHeadingRuns(md)
  md = remapHeadingLevels(md)
  // Only now — headings are in their final, remapped form — can we know
  // which "#anchor" targets could possibly resolve.
  md = dropUnresolvableAnchorLinks(md)
  md = md.trim() + '\n'
  return md
}

// ── Description derivation ──────────────────────────────────────────────────
function deriveDescription(metadesc, markdownBody) {
  const cleanedMeta = collapseWhitespace(metadesc || '')
  if (cleanedMeta) return cleanedMeta.slice(0, 160)

  const blocks = markdownBody.split(/\n\s*\n/)
  for (const rawBlock of blocks) {
    const block = rawBlock.trim()
    if (!block) continue
    if (block.startsWith('#')) continue
    if (block.startsWith('|')) continue
    if (block === '---') continue
    if (MD_IMAGE_ONLY_LINE_RE.test(block)) continue
    if (/^TABLEPLACEHOLDERXYZ\d+$/.test(block)) continue

    let text = block.replace(/\n/g, ' ')
    text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Un-escape backslash-escaped markdown chars BEFORE stripping them, or
    // a decorative "\_\_\_\_\_...\_\_\_\_" separator bar (turndown escapes
    // every underscore) turns into a bare wall of backslashes once the
    // underscores themselves are removed.
    text = text.replace(/\\([*_`#\\])/g, '$1')
    text = text.replace(/[*_`#]/g, '')
    text = collapseWhitespace(text)
    if (!text) continue
    // Skip decorative separator lines (e.g. a bar of underscores/dashes)
    // that have no actual letters or digits — not a real paragraph.
    if (!/[a-zA-Z0-9À-ÿ]/.test(text)) continue

    if (text.length <= 160) return text
    const truncated = text.slice(0, 160)
    const lastSpace = truncated.lastIndexOf(' ')
    return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated).trim()
  }
  return undefined
}

// ── Per-article conversion ──────────────────────────────────────────────────
function convertArticle(article, td, imageDimsCache) {
  const { fm, year, slug, dirName, articleDir, bodyRaw } = article
  const title = collapseWhitespace(decodeEntities(fm.title || ''))

  // Drop the leading "# Title" markdown heading line the backup adds before
  // the raw HTML body.
  let html = bodyRaw.replace(/^\s*#[^\n]*\n+/, '')

  const dom = new JSDOM(`<!doctype html><body><div id="root">${html}</div></body>`)
  const root = dom.window.document.getElementById('root')

  removeCommentsScriptsStyles(root)
  removeWordJunkElements(root)
  normalizeNbsp(root)

  // Drop a body <h1> that just repeats the title.
  for (const h1 of Array.from(root.querySelectorAll('h1'))) {
    if (collapseWhitespace(h1.textContent).toLowerCase() === title.toLowerCase()) h1.remove()
  }

  unwrapPresentationalTags(root)

  for (const colEl of Array.from(root.querySelectorAll('colgroup, col'))) colEl.remove()

  dedupeConsecutiveImages(root)

  // Links BEFORE images: a "files/..." or Joomla index.php anchor is always
  // fully discarded (dropped anchor, no textual label to keep) — when its
  // only content is an <img> (e.g. a "logo_pdf.png" icon), that image must
  // never reach resolveImage(), or it would get staged to disk with nothing
  // in the final markdown pointing at it (an orphaned staged file).
  processLinks(root)

  let firstImagePath
  const usedFilenames = new Set()
  const ctx = {
    year,
    slug,
    title,
    articleDir,
    dryRun: DRY_RUN,
    getImageDims(sourceFile) {
      if (imageDimsCache.has(sourceFile)) return imageDimsCache.get(sourceFile)
      // Best-effort pre-pass missed this one (e.g. an entity-encoded src) —
      // fall back to a blocking single-file lookup and cache the result
      // (including a null miss) so it's never re-spawned.
      const dims = identifyOneSync(sourceFile)
      imageDimsCache.set(sourceFile, dims)
      return dims
    },
    uniqueSafeFilename(originalName) {
      let safe = safeFilename(originalName)
      if (usedFilenames.has(safe)) {
        const ext = path.extname(safe)
        const base = safe.slice(0, safe.length - ext.length)
        let n = 2
        while (usedFilenames.has(`${base}-${n}${ext}`)) n++
        safe = `${base}-${n}${ext}`
      }
      usedFilenames.add(safe)
      return safe
    },
  }
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const rewritten = resolveImage(img, ctx)
    if (rewritten && !firstImagePath) firstImagePath = rewritten
  }

  removeEmptyLinks(root)

  processTables(td, root)
  stripAttributes(root)
  removeEmptyElements(root)

  let markdownBody = td.turndown(root)
  markdownBody = finalizeMarkdown(markdownBody)

  const isEmptyBody = collapseWhitespace(markdownBody.replace(/TABLEPLACEHOLDERXYZ\d+/g, '')) === ''
  if (isEmptyBody) report.emptyBodyArticles.push(`${year}/${dirName}`)

  const datePart = (fm.publish_up || '').slice(0, 10)
  const createdPart = (fm.created || '').slice(0, 10)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : (/^\d{4}-\d{2}-\d{2}$/.test(createdPart) ? createdPart : undefined)

  const outputFm = {
    title,
    description: deriveDescription(decodeEntities(fm.metadesc || ''), markdownBody),
    date,
    year: Number(year),
    category: collapseWhitespace(decodeEntities(fm.category || '')) || undefined,
    journal: fm.journal_year && fm.journal_month ? `${fm.journal_year}-${fm.journal_month}` : undefined,
    image: firstImagePath,
    joomlaId: Number(fm.joomla_id),
    hits: fm.hits !== undefined && fm.hits !== '' ? Number(fm.hits) : undefined,
  }

  // Only now — after finalizeMarkdown()'s heading/thematic-break logic and
  // deriveDescription() have both looked at markdownBody — turn the
  // "@@MDCDIM@@..." markers into real "{width=...}" MDC attribute blocks.
  // Both of those passes rely on `![alt](url)` being a single, complete-
  // looking unit with nothing trailing outside the parens; the marker lives
  // *inside* the parens for exactly that reason (see its own comment).
  markdownBody = resolveImageDimensionMarkers(markdownBody)

  const fileContent = `${serializeFrontmatter(outputFm)}\n\n${markdownBody}`
  return { fileContent, outputFm, markdownBody }
}

// ── Main ─────────────────────────────────────────────────────────────────────
function wipeOutputDirs() {
  if (existsSync(OUTPUT_CONTENT_DIR)) rmSync(OUTPUT_CONTENT_DIR, { recursive: true, force: true })
  if (existsSync(STAGING_IMAGES_DIR)) rmSync(STAGING_IMAGES_DIR, { recursive: true, force: true })
  mkdirSync(OUTPUT_CONTENT_DIR, { recursive: true })
  mkdirSync(STAGING_IMAGES_DIR, { recursive: true })
}

async function main() {
  if (!DRY_RUN) wipeOutputDirs()

  const articles = resolveSlugs(discoverArticles())
  const imageDimsCache = await buildImageDimsCache(articles)
  const td = createTurndownService()
  const writtenPaths = new Set()

  for (const article of articles) {
    tablePlaceholders.clear()
    tablePlaceholderCounter = 0

    const { fileContent } = convertArticle(article, td, imageDimsCache)

    const outPath = path.join(OUTPUT_CONTENT_DIR, article.year, `${article.slug}.md`)
    if (writtenPaths.has(outPath)) {
      throw new Error(`Duplicate output path detected: ${outPath} (from ${article.year}/${article.dirName})`)
    }
    writtenPaths.add(outPath)

    if (!DRY_RUN) {
      mkdirSync(path.dirname(outPath), { recursive: true })
      writeFileSync(outPath, fileContent, 'utf8')
    }

    report.converted++
    report.perYear[article.year] = (report.perYear[article.year] || 0) + 1
  }

  printReport(articles.length)
  if (!DRY_RUN) runVerification()
}

function printReport(totalSelected) {
  console.log('\n=== IMPORT REPORT ===')
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (nothing written)' : 'WRITE'}${ONLY ? ` — only matching "${ONLY}"` : ''}`)
  console.log(`Articles converted: ${report.converted} / ${totalSelected} selected`)
  console.log('Per-year counts:')
  for (const year of Object.keys(report.perYear).sort()) {
    console.log(`  ${year}: ${report.perYear[year]}`)
  }
  console.log(`Tables kept as GFM pipe tables: ${report.tablesKept}`)
  console.log(`Tables unwrapped as layout: ${report.tablesUnwrapped}`)
  console.log(`Images rewritten (article-local): ${report.imagesRewrittenLocal}`)
  console.log(`Images recovered from photo tree: ${report.imagesRecoveredFromPhotos}`)
  console.log(`Images dropped (missing file): ${report.imagesDroppedMissing}`)
  console.log(`Images dropped (external/file:/data:): ${report.imagesDroppedExternal}`)
  console.log(`Images with width+height emitted: ${report.imagesWithWidthAndHeight}`)
  console.log(`Images with width only emitted (real dims unreadable): ${report.imagesWithWidthOnly}`)
  console.log(`Image size sourced from HTML (width=/style): ${report.imagesSizeFromHtml}`)
  console.log(`Image size sourced from real file dimensions: ${report.imagesSizeFromFile}`)
  console.log(`Image widths capped at ${MAX_DISPLAY_WIDTH}: ${report.imagesSizeCapped}`)
  console.log(`Images with no size info at all (no {width=} emitted): ${report.imagesNoDimsAvailable}`)
  console.log(`"files/" links flattened to plain text: ${report.filesLinksFlattened}`)
  console.log(`Own-domain (dead Joomla) links flattened to plain text: ${report.ownDomainLinksFlattened}`)
  console.log(`Empty links removed: ${report.emptyLinksRemoved}`)
  console.log(`Unresolvable "#anchor" links flattened to plain text: ${report.unresolvableAnchorLinksDropped}`)
  console.log(`Slug collisions resolved (articles affected): ${report.slugCollisionsResolved}`)
  console.log(`Decorative heading bars converted to thematic breaks: ${report.decorativeHeadingBarsFixed}`)
  console.log(`  of which dropped as leading/trailing block: ${report.decorativeHeadingBarsDroppedAtBoundary}`)
  console.log(`Image-only headings unwrapped to paragraphs: ${report.imageOnlyHeadingsUnwrapped}`)
  console.log(`Image+text headings split (image hoisted before heading): ${report.imageHeadingsWithTextSplit}`)
  console.log(`Heading lines remapped to normalized levels: ${report.headingLinesRemapped}`)
  console.log(`Files with at least one heading level remapped: ${report.filesWithHeadingLevelsRemapped}`)
  console.log(`Headings kept as real headings: ${report.headingsKept}`)
  console.log(`Headings demoted — body text, length > 120: ${report.headingsDemotedLength}`)
  console.log(`Headings demoted — body text, length > 60 + terminal punctuation: ${report.headingsDemotedTerminalPunct}`)
  console.log(`Headings demoted — body text, 2+ sentence boundaries: ${report.headingsDemotedMultiSentence}`)
  console.log(`Headings demoted — no letters at all: ${report.headingsDemotedLetterless}`)
  console.log(`Headings dropped outright — letterless AND empty: ${report.headingsDroppedLetterlessEmpty}`)
  console.log(`Heading runs collapsed into lists: ${report.headingRunsCollapsed}`)
  console.log(`Headings lost to run-collapsing: ${report.headingsLostToRuns}`)
  console.log(`List items created from collapsed runs: ${report.listItemsCreatedFromRuns}`)
  console.log(`Bare dead club-domain URLs removed from prose: ${report.bareOwnDomainUrlsRemoved}`)
  console.log(`Articles with an empty body: ${report.emptyBodyArticles.length}`)
  if (report.emptyBodyArticles.length) {
    for (const a of report.emptyBodyArticles) console.log(`  - ${a}`)
  }
  const topTags = Array.from(report.strippedTagCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15)
  console.log('Top residual raw-HTML tags stripped from markdown:')
  if (topTags.length === 0) console.log('  (none)')
  for (const [tag, count] of topTags) console.log(`  <${tag}>: ${count}`)
  console.log('======================\n')
}

// ── Post-run verification ────────────────────────────────────────────────────
function walkFiles(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkFiles(full))
    else out.push(full)
  }
  return out
}

function runVerification() {
  console.log('=== VERIFICATION ===')
  let allOk = true

  // 1. File count.
  const mdFiles = walkFiles(OUTPUT_CONTENT_DIR).filter((f) => f.endsWith('.md'))
  const countOk = mdFiles.length === 244
  allOk = allOk && countOk
  console.log(`[${countOk ? 'PASS' : 'FAIL'}] output file count === 244 (got ${mdFiles.length})`)

  // 2. Forbidden leftovers.
  const forbiddenRe = /&nbsp;|<span|<font|<div|<w:|<o:|style=|class=/i
  const withForbidden = []
  for (const f of mdFiles) {
    const content = readFileSync(f, 'utf8')
    if (forbiddenRe.test(content)) withForbidden.push(f)
  }
  const forbiddenOk = withForbidden.length === 0
  allOk = allOk && forbiddenOk
  console.log(`[${forbiddenOk ? 'PASS' : 'FAIL'}] no forbidden leftovers (&nbsp;/<span/<font/<div/<w:/<o:/style=/class=) — ${withForbidden.length} file(s) affected`)
  if (!forbiddenOk) withForbidden.slice(0, 10).forEach((f) => console.log(`    - ${f}`))

  // 3. No un-rewritten local image src.
  const rawImgRe = /src="images\//
  const withRawImg = mdFiles.filter((f) => rawImgRe.test(readFileSync(f, 'utf8')))
  const rawImgOk = withRawImg.length === 0
  allOk = allOk && rawImgOk
  console.log(`[${rawImgOk ? 'PASS' : 'FAIL'}] no un-rewritten 'src="images/' left — ${withRawImg.length} file(s) affected`)

  // 4. Image reference <-> staged file parity.
  const referenced = new Set()
  for (const f of mdFiles) {
    const content = readFileSync(f, 'utf8')
    for (const m of content.matchAll(/\/images\/archives\/[^\s")]+/g)) referenced.add(m[0])
  }
  const staged = new Set()
  for (const f of walkFiles(STAGING_IMAGES_DIR)) {
    staged.add('/images/archives/' + path.relative(STAGING_IMAGES_DIR, f).split(path.sep).join('/'))
  }
  const referencedNotStaged = Array.from(referenced).filter((p) => !staged.has(p))
  const stagedNotReferenced = Array.from(staged).filter((p) => !referenced.has(p))
  const parityOk = referencedNotStaged.length === 0 && stagedNotReferenced.length === 0
  allOk = allOk && parityOk
  console.log(`[${parityOk ? 'PASS' : 'FAIL'}] every referenced image is staged and vice-versa — ${referencedNotStaged.length} referenced-not-staged, ${stagedNotReferenced.length} staged-not-referenced`)
  if (!parityOk) {
    referencedNotStaged.slice(0, 10).forEach((p) => console.log(`    referenced-not-staged: ${p}`))
    stagedNotReferenced.slice(0, 10).forEach((p) => console.log(`    staged-not-referenced: ${p}`))
  }

  // 5. Frontmatter well-formedness (hand-rolled, since we hand-rolled the writer too).
  let fmBad = []
  for (const f of mdFiles) {
    const content = readFileSync(f, 'utf8')
    const m = content.match(/^---\n([\s\S]*?)\n---\n/)
    if (!m) { fmBad.push(`${f}: no frontmatter block`); continue }
    const fm = parseFrontmatter(m[1])
    if (fm.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(fm.date)) fmBad.push(`${f}: bad date "${fm.date}"`)
    if (!fm.title) fmBad.push(`${f}: missing title`)
    if (fm.year === undefined || !/^\d+$/.test(fm.year)) fmBad.push(`${f}: bad year "${fm.year}"`)
    if (fm.joomlaId === undefined || !/^\d+$/.test(fm.joomlaId)) fmBad.push(`${f}: bad joomlaId "${fm.joomlaId}"`)
  }
  const fmOk = fmBad.length === 0
  allOk = allOk && fmOk
  console.log(`[${fmOk ? 'PASS' : 'FAIL'}] frontmatter well-formed on all files — ${fmBad.length} issue(s)`)
  fmBad.slice(0, 10).forEach((msg) => console.log(`    - ${msg}`))

  // 6. No body H1.
  const withH1 = mdFiles.filter((f) => /^# /m.test(readFileSync(f, 'utf8')))
  const h1Ok = withH1.length === 0
  allOk = allOk && h1Ok
  console.log(`[${h1Ok ? 'PASS' : 'FAIL'}] no body "# " H1 — ${withH1.length} file(s) affected`)
  if (!h1Ok) withH1.slice(0, 10).forEach((f) => console.log(`    - ${f}`))

  // 7. No image-only/image-leading heading left.
  const withImgHeading = mdFiles.filter((f) => /^#{1,6} *!\[/m.test(readFileSync(f, 'utf8')))
  const imgHeadingOk = withImgHeading.length === 0
  allOk = allOk && imgHeadingOk
  console.log(`[${imgHeadingOk ? 'PASS' : 'FAIL'}] no image-only/image-leading heading — ${withImgHeading.length} file(s) affected`)
  if (!imgHeadingOk) withImgHeading.slice(0, 10).forEach((f) => console.log(`    - ${f}`))

  // 8. No decorative-bar heading left.
  const decorativeHeadingRe = /^#{1,6} [\\_=~. *·-]+$/m
  const withDecorativeHeading = mdFiles.filter((f) => decorativeHeadingRe.test(readFileSync(f, 'utf8')))
  const decorativeOk = withDecorativeHeading.length === 0
  allOk = allOk && decorativeOk
  console.log(`[${decorativeOk ? 'PASS' : 'FAIL'}] no decorative-bar heading left — ${withDecorativeHeading.length} file(s) affected`)
  if (!decorativeOk) withDecorativeHeading.slice(0, 10).forEach((f) => console.log(`    - ${f}`))

  // 9. Every markdown image now carries an MDC "{width="..." attribute block,
  // and the `image:` frontmatter value stays a bare path (no attribute
  // block — it's consumed by a Vue component, not the markdown parser).
  const MD_IMAGE_WITH_PAREN_RE = /!\[[^\]]*\]\([^)]+\)/g
  const withoutWidth = []
  const fmImageWithAttrs = []
  for (const f of mdFiles) {
    const content = readFileSync(f, 'utf8')
    for (const m of content.matchAll(MD_IMAGE_WITH_PAREN_RE)) {
      const endIdx = m.index + m[0].length
      if (content.slice(endIdx, endIdx + 8) !== '{width="') withoutWidth.push(`${f}: ${m[0]}`)
    }
    const fmMatch = content.match(/^---\n[\s\S]*?\nimage:\s*"([^"]*)"/m)
    if (fmMatch && fmMatch[1].includes('{')) fmImageWithAttrs.push(f)
  }
  const widthOk = withoutWidth.length === 0
  allOk = allOk && widthOk
  console.log(`[${widthOk ? 'PASS' : 'FAIL'}] every markdown image has a {width="...} block — ${withoutWidth.length} missing`)
  if (!widthOk) withoutWidth.slice(0, 10).forEach((m) => console.log(`    - ${m}`))
  const fmImageOk = fmImageWithAttrs.length === 0
  allOk = allOk && fmImageOk
  console.log(`[${fmImageOk ? 'PASS' : 'FAIL'}] frontmatter "image:" stays a bare path (no attribute block) — ${fmImageWithAttrs.length} file(s) affected`)
  if (!fmImageOk) fmImageWithAttrs.slice(0, 10).forEach((f) => console.log(`    - ${f}`))

  // 10. No emitted width/height exceeds MAX_DISPLAY_WIDTH, is <= 0, or is
  // non-integer.
  const ATTR_RE = /\{width="(\d+)"(?: height="(\d+)")?\}/g
  const sizeIssues = []
  const allSizedImages = []
  for (const f of mdFiles) {
    const content = readFileSync(f, 'utf8')
    for (const m of content.matchAll(ATTR_RE)) {
      const w = Number(m[1])
      const h = m[2] !== undefined ? Number(m[2]) : null
      allSizedImages.push({ f, content, index: m.index, w, h })
      if (!Number.isInteger(w) || w <= 0 || w > MAX_DISPLAY_WIDTH) sizeIssues.push(`${f}: width=${m[1]}`)
      if (h !== null && (!Number.isInteger(h) || h <= 0)) sizeIssues.push(`${f}: height=${m[2]}`)
    }
  }
  const sizeOk = sizeIssues.length === 0
  allOk = allOk && sizeOk
  console.log(`[${sizeOk ? 'PASS' : 'FAIL'}] no emitted width/height is 0, negative, non-integer, or > ${MAX_DISPLAY_WIDTH} — ${sizeIssues.length} issue(s)`)
  if (!sizeOk) sizeIssues.slice(0, 10).forEach((m) => console.log(`    - ${m}`))

  // 11. Aspect-ratio spot check: for a random sample of emitted images that
  // carry both width and height, confirm the ratio matches the real staged
  // file's ratio within 2%.
  const withBoth = allSizedImages.filter((x) => x.h !== null)
  const sampleSize = Math.min(30, withBoth.length)
  const sample = []
  const pool = withBoth.slice()
  for (let i = 0; i < sampleSize && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length)
    sample.push(pool[idx])
    pool.splice(idx, 1)
  }
  const outliers = []
  for (const { content, index, w, h } of sample) {
    const before = content.slice(0, index)
    const srcMatch = before.match(/!\[[^\]]*\]\(([^)]+)\)$/)
    if (!srcMatch) continue
    const relSrc = srcMatch[1]
    const stagedFile = path.join(STAGING_IMAGES_DIR, relSrc.replace(/^\/images\/archives\//, ''))
    const real = existsSync(stagedFile) ? identifyOneSync(stagedFile) : null
    if (!real) continue
    const emittedRatio = w / h
    const realRatio = real.w / real.h
    const diff = Math.abs(emittedRatio - realRatio) / realRatio
    if (diff > 0.02) outliers.push(`${relSrc}: emitted ${w}x${h} (${emittedRatio.toFixed(3)}) vs real ${real.w}x${real.h} (${realRatio.toFixed(3)}), off by ${(diff * 100).toFixed(1)}%`)
  }
  const aspectOk = outliers.length === 0
  allOk = allOk && aspectOk
  console.log(`[${aspectOk ? 'PASS' : 'FAIL'}] aspect ratio within 2% on a sample of ${sample.length} images — ${outliers.length} outlier(s)`)
  outliers.forEach((m) => console.log(`    - ${m}`))

  // 12. Escaping self-test: an intentional "{width=...}" attribute block
  // (produced by resolveImageDimensionMarkers, after escaping already ran)
  // survives, AND a genuine "){" typed in source prose (present before
  // escaping ran) still gets escaped by escapeMdcUnsafeSequences.
  const escapeTestIssues = []
  {
    const intentional = resolveImageDimensionMarkers(escapeMdcUnsafeSequences('![alt](/images/archives/x/y/z.png@@MDCDIM@@70@@66@@)'))
    if (intentional !== '![alt](/images/archives/x/y/z.png){width="70" height="66"}') {
      escapeTestIssues.push(`intentional attribute block did not survive: got "${intentional}"`)
    }
    const widthOnly = resolveImageDimensionMarkers(escapeMdcUnsafeSequences('![alt](/img.png@@MDCDIM@@1024@@NONE@@)'))
    if (widthOnly !== '![alt](/img.png){width="1024"}') {
      escapeTestIssues.push(`intentional width-only attribute block did not survive: got "${widthOnly}"`)
    }
    const sourceProse = escapeMdcUnsafeSequences('foo){bar} and baz]{qux}')
    if (!sourceProse.includes(')\\{bar}') || !sourceProse.includes(']\\{qux}')) {
      escapeTestIssues.push(`a genuine "){"/"]{" from source prose was not escaped: got "${sourceProse}"`)
    }
  }
  const escapeOk = escapeTestIssues.length === 0
  allOk = allOk && escapeOk
  console.log(`[${escapeOk ? 'PASS' : 'FAIL'}] escaping self-test (intentional attrs survive, source "){"/"]{"" still escaped) — ${escapeTestIssues.length} issue(s)`)
  escapeTestIssues.forEach((m) => console.log(`    - ${m}`))

  // 13. No dead links to the club's own (old Joomla) domain survive.
  const OWN_DOMAIN_LINK_LEFTOVER_RE = /\]\(https?:\/\/(www\.)?petanque-?fouesnantaise\.fr[^)]*\)/i
  const withOwnDomainLink = mdFiles.filter((f) => OWN_DOMAIN_LINK_LEFTOVER_RE.test(readFileSync(f, 'utf8')))
  const ownDomainOk = withOwnDomainLink.length === 0
  allOk = allOk && ownDomainOk
  console.log(`[${ownDomainOk ? 'PASS' : 'FAIL'}] no dead links to the club's own domain — ${withOwnDomainLink.length} file(s) affected`)
  if (!ownDomainOk) withOwnDomainLink.slice(0, 10).forEach((f) => console.log(`    - ${f}`))

  // 14. No empty-text links (`[ ]( ... )`, including a bare `[]( ... )`).
  const EMPTY_LINK_RE = /\[\s*\]\([^)]*\)/
  const withEmptyLink = mdFiles.filter((f) => EMPTY_LINK_RE.test(readFileSync(f, 'utf8')))
  const emptyLinkOk = withEmptyLink.length === 0
  allOk = allOk && emptyLinkOk
  console.log(`[${emptyLinkOk ? 'PASS' : 'FAIL'}] no empty-text links — ${withEmptyLink.length} file(s) affected`)
  if (!emptyLinkOk) withEmptyLink.slice(0, 10).forEach((f) => console.log(`    - ${f}`))

  // 15. External links to OTHER hosts still survive as real links (sanity —
  // this change must not have over-flattened).
  const externalLinks = []
  for (const f of mdFiles) {
    const content = readFileSync(f, 'utf8')
    for (const m of content.matchAll(/\]\((https?:\/\/[^)]+)\)/g)) externalLinks.push(m[1])
  }
  const nonClubExternal = externalLinks.filter((href) => !OWN_DOMAIN_LINK_RE.test(href))
  const clubLeftInExternal = externalLinks.filter((href) => OWN_DOMAIN_LINK_RE.test(href))
  const externalOk = clubLeftInExternal.length === 0
  allOk = allOk && externalOk
  console.log(`[${externalOk ? 'PASS' : 'FAIL'}] external "](http" links: ${externalLinks.length} total, ${nonClubExternal.length} non-club — ${clubLeftInExternal.length} still point at the club's own domain`)
  nonClubExternal.slice(0, 5).forEach((href) => console.log(`    example: ${href}`))
  const externalCountOk = nonClubExternal.length === 32
  allOk = allOk && externalCountOk
  console.log(`[${externalCountOk ? 'PASS' : 'FAIL'}] external non-club link count === 32 (got ${nonClubExternal.length})`)

  // 16. No heading (raw line, hashes + space stripped) longer than 120 raw
  // characters survives — the blunt, literal form of the check (on the raw
  // heading line, not the markdown-stripped "eval text" demoteNonHeadings()
  // judges length on), since that's what the coordinator's own grep checks.
  const LONG_HEADING_RE = /^#{2,6} .{120,}$/m
  const withLongHeading = mdFiles.filter((f) => LONG_HEADING_RE.test(readFileSync(f, 'utf8')))
  const longHeadingOk = withLongHeading.length === 0
  allOk = allOk && longHeadingOk
  console.log(`[${longHeadingOk ? 'PASS' : 'FAIL'}] no heading line > 120 raw chars — ${withLongHeading.length} file(s) affected`)
  if (!longHeadingOk) withLongHeading.slice(0, 10).forEach((f) => console.log(`    - ${f}`))

  // 17. No surviving heading whose text has no letters at all (would
  // slugify to empty, leaving @nuxt/content's "_1"/"_2" id fallback and an
  // accessible-text-less anchor link on ProseH*) — including a heading with
  // NO content whatsoever (not even a trailing space), which is the same
  // defect in its most extreme form.
  let letterlessHeadingCount = 0
  const filesWithLetterlessHeading = []
  for (const f of mdFiles) {
    const content = readFileSync(f, 'utf8')
    let fileHasOne = false
    for (const line of content.split('\n')) {
      if (/^#{2,6}[ \t]*$/.test(line)) { letterlessHeadingCount++; fileHasOne = true; continue }
      const m = line.match(/^(#{2,6}) (.*)$/)
      if (!m) continue
      const plain = headingPlainText(m[2])
      if (plain !== '' && !/\p{L}/u.test(plain)) { letterlessHeadingCount++; fileHasOne = true }
    }
    if (fileHasOne) filesWithLetterlessHeading.push(f)
  }
  const letterlessOk = letterlessHeadingCount === 0
  allOk = allOk && letterlessOk
  console.log(`[${letterlessOk ? 'PASS' : 'FAIL'}] no letterless heading survives — ${letterlessHeadingCount} found`)
  if (!letterlessOk) filesWithLetterlessHeading.slice(0, 10).forEach((f) => console.log(`    - ${f}`))

  // 18. No bare (non-markdown-link) dead club-domain URL survives in prose.
  const BARE_CLUB_URL_CHECK_RE = /(^|[^(])https?:\/\/(www\.)?petanque-?fouesnantaise\.fr[^ )]*/
  const withBareClubUrl = mdFiles.filter((f) => BARE_CLUB_URL_CHECK_RE.test(readFileSync(f, 'utf8')))
  const bareClubUrlOk = withBareClubUrl.length === 0
  allOk = allOk && bareClubUrlOk
  console.log(`[${bareClubUrlOk ? 'PASS' : 'FAIL'}] no bare dead club-domain URL in prose — ${withBareClubUrl.length} file(s) affected`)
  if (!bareClubUrlOk) withBareClubUrl.slice(0, 10).forEach((f) => console.log(`    - ${f}`))

  // 19. Image dimension count is unaffected by any of the above (still
  // exactly 1654, same as the last pass).
  const totalWidthBlocks = mdFiles.reduce((sum, f) => sum + (readFileSync(f, 'utf8').match(/\{width="\d+"/g) || []).length, 0)
  const widthCountOk = totalWidthBlocks === 1654
  allOk = allOk && widthCountOk
  console.log(`[${widthCountOk ? 'PASS' : 'FAIL'}] total {width=...} blocks === 1654 (got ${totalWidthBlocks})`)

  // 20. Independent re-detection of "3+ consecutive short same-level
  // headings, separated only by blank lines" runs in the FINAL output —
  // must be 0. Re-implemented against the written files (not by trusting
  // collapseHeadingRuns()'s own bookkeeping) as a genuine second check;
  // advances one block at a time (never jumps past a non-qualifying
  // pair) so a run starting at the SECOND block of a broken pair is never
  // missed — the same reason collapseHeadingRuns() itself advances by 1.
  let residualRuns = 0
  const filesWithResidualRuns = []
  for (const f of mdFiles) {
    const content = readFileSync(f, 'utf8')
    const blocks = content.trim().split('\n\n')
    let fileHasRun = false
    for (let i = 0; i < blocks.length; i++) {
      const first = shortHeadingBlockInfo(blocks[i])
      if (!first) continue
      let runLen = 1
      let j = i + 1
      while (j < blocks.length) {
        const next = shortHeadingBlockInfo(blocks[j])
        if (!next || next.level !== first.level) break
        runLen++
        j++
      }
      if (runLen >= 3) { residualRuns++; fileHasRun = true }
    }
    if (fileHasRun) filesWithResidualRuns.push(f)
  }
  const runsOk = residualRuns === 0
  allOk = allOk && runsOk
  console.log(`[${runsOk ? 'PASS' : 'FAIL'}] no residual runs of 3+ consecutive short same-level headings — ${residualRuns} found`)
  if (!runsOk) filesWithResidualRuns.slice(0, 10).forEach((f) => console.log(`    - ${f}`))

  // Total heading count across all files (simple per-line scan, independent
  // of the run/short-heading machinery above).
  let totalHeadingCount = 0
  for (const f of mdFiles) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(HEADING_LINE_RE)
      if (m && m[2].trim() !== '') totalHeadingCount++
    }
  }
  console.log(`Total heading count across all files (post run-collapse): ${totalHeadingCount}`)

  console.log(`\nOVERALL: ${allOk ? 'PASS' : 'FAIL'}`)
  console.log('=====================\n')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
