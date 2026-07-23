#!/usr/bin/env node
// Canonicalize content/**/*.md into the SAME markdown serialization that Nuxt
// Studio and the @nuxt/content build agree on, so Studio stops flagging
// phantom "conflicts" on files that were only ever hand-edited.
//
// HOW IT WORKS
// It runs the project's OWN @nuxtjs/mdc pipeline (resolved through @nuxt/content
// so it is byte-for-byte the version the build uses — pinned to 0.22.2 via
// pnpm-workspace.yaml overrides). For each file it:
//   1. parses the markdown body with the exact options Nuxt Studio uses
//      (parser/index.js): remark-emoji + remark-mdc { autoUnwrap: true },
//      mdc defaults (rehype-external-links → rel=nofollow, attribute sorting,
//      rehype-raw), highlight theme;
//   2. stringifies that AST back to markdown with Studio's stringify options
//      (autoUnwrap: true, frontMatter lineWidth: 0, bullet "-", the &#x2A;→*
//      fixup) — i.e. it reproduces Studio's own round-trip
//      (generate.js: generateDocumentFromContent → generateContentFromMarkdownDocument).
// The frontmatter block is preserved verbatim (only the body is normalized),
// so schema fields and key order never drift.
//
// The result is a fixed point: parsing then re-stringifying it is a no-op,
// which is what makes Studio's git-vs-D1 comparison match.
//
// IMPORTANT — this canonicalizer is necessary but NOT sufficient on its own.
// Nuxt Studio 1.7.0 hardcodes remark-mdc autoUnwrap:true, but @nuxt/content's
// build defaults to autoUnwrap:false. So the DEPLOYED D1 body wraps every
// single-paragraph MDC component child in <p>, while Studio's parse unwraps it
// — a structural mismatch no markdown rewrite can fix. To fully kill the
// conflict you MUST also align the build by adding to nuxt.config.ts:
//   content: { build: { markdown: { remarkPlugins: {
//     'remark-mdc': { options: { autoUnwrap: true } } } } } }
// With that + the mdc pin, the build's D1 body and Studio's parse are identical
// for ANY markdown, and this canonicalizer just keeps the committed text tidy
// and stable.
//
// Usage:
//   node scripts/canonicalize-content.mjs [file ...]   # specific files
//   node scripts/canonicalize-content.mjs              # all content/**/*.md
//   node scripts/canonicalize-content.mjs --check ...  # exit 1 if any change

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve, relative } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// ---- Resolve @nuxtjs/mdc EXACTLY as the build does: through @nuxt/content ----
// node_modules/@nuxt/content is a pnpm symlink into .pnpm; its own
// node_modules/@nuxtjs/mdc symlink is the precise version the build loads.
// Fall back to scanning .pnpm (the pin in pnpm-workspace.yaml guarantees a
// single @nuxtjs/mdc version, so any match is the right one).
function resolveMdcDir () {
  // Resolve the SAME @nuxtjs/mdc the build loads by asking Node to resolve it
  // from @nuxt/content's own module (mirrors the build's import graph). Stale
  // duplicate versions may still sit in .pnpm on disk; this picks the linked one.
  try {
    const contentDir = realpathSync(join(ROOT, 'node_modules/@nuxt/content'))
    const cReq = createRequire(join(contentDir, 'dist/module.mjs'))
    const entry = cReq.resolve('@nuxtjs/mdc') // .../node_modules/@nuxtjs/mdc/dist/module.mjs
    const idx = entry.lastIndexOf('@nuxtjs/mdc')
    if (idx !== -1) return entry.slice(0, idx + '@nuxtjs/mdc'.length)
  } catch { /* fall through */ }
  const pnpmDir = join(ROOT, 'node_modules/.pnpm')
  const match = readdirSync(pnpmDir).find((d) => /^@nuxtjs\+mdc@/.test(d) &&
    existsSync(join(pnpmDir, d, 'node_modules/@nuxtjs/mdc/dist/runtime')))
  if (!match) throw new Error('Could not locate @nuxtjs/mdc under node_modules')
  return join(pnpmDir, match, 'node_modules/@nuxtjs/mdc')
}
const mdcDir = resolveMdcDir()
const runtime = join(mdcDir, 'dist/runtime')

const { parseMarkdown } = await import(pathToFileURL(join(runtime, 'parser/index.js')).href)
const { stringifyMarkdown } = await import(pathToFileURL(join(runtime, 'stringify/index.js')).href)

// remark-emoji resolved from mdc's own tree (the build adds it as a plugin).
const emojiReq = createRequire(join(mdcDir, 'package.json'))
let remarkEmoji
try { remarkEmoji = (await import(pathToFileURL(emojiReq.resolve('remark-emoji')).href)).default } catch { remarkEmoji = undefined }

const mdcVersion = JSON.parse(readFileSync(join(mdcDir, 'package.json'), 'utf8')).version

// Parse options mirroring nuxt-studio generate.js (the side that flags conflicts).
const PARSE_OPTS = {
  contentHeading: true, // 'page' collections (all content here are type:'page')
  highlight: { theme: { light: 'material-theme-lighter', default: 'material-theme', dark: 'material-theme-palenight' } },
  remark: {
    plugins: {
      ...(remarkEmoji ? { emoji: { instance: remarkEmoji } } : {}),
      'remark-mdc': { options: { autoUnwrap: true } },
    },
  },
}
const STRINGIFY_OPTS = {
  frontMatter: { options: { lineWidth: 0 } },
  plugins: { remarkMDC: { options: { autoUnwrap: true } } },
}

const FRONTMATTER_RE = /^(---\r?\n[\s\S]*?\r?\n---)\r?\n?/

async function canonicalizeMarkdown (raw) {
  const m = raw.match(FRONTMATTER_RE)
  const fmBlock = m ? m[1] : null
  const body = m ? raw.slice(m[0].length) : raw
  const doc = await parseMarkdown(body, PARSE_OPTS)
  // Studio drops rel before stringifying (it is re-added on parse via
  // rehype-external-links), so the committed markdown has clean links.
  const { visit } = await import(pathToFileURL(emojiReq.resolve('unist-util-visit')).href).catch(() => ({ visit: null }))
  if (visit) visit(doc.body, (n) => n?.type === 'element' && n.tag === 'a', (n) => { Reflect.deleteProperty(n.props || {}, 'rel') })
  let bodyMd = await stringifyMarkdown(doc.body, {}, STRINGIFY_OPTS)
  if (typeof bodyMd === 'string') bodyMd = bodyMd.replace(/&#x2A;/g, '*')
  const out = fmBlock ? `${fmBlock}\n\n${bodyMd}` : bodyMd
  return out.endsWith('\n') ? out : out + '\n'
}

function collectFiles (args) {
  if (args.length) return args.map((a) => resolve(a))
  const dir = join(ROOT, 'content')
  const out = []
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.md')) out.push(p)
    }
  }
  if (existsSync(dir)) walk(dir)
  return out
}

const rawArgs = process.argv.slice(2)
const check = rawArgs.includes('--check')
const files = collectFiles(rawArgs.filter((a) => a !== '--check'))

console.error(`[canonicalize] @nuxtjs/mdc@${mdcVersion} (via @nuxt/content) — ${files.length} file(s)`)
let changed = 0
for (const file of files) {
  const before = readFileSync(file, 'utf8')
  const after = await canonicalizeMarkdown(before)
  const rel = relative(ROOT, file)
  if (before !== after) {
    changed++
    if (check) console.error(`  CHANGED ${rel}`)
    else { writeFileSync(file, after); console.error(`  rewrote ${rel}`) }
  }
}
if (check && changed) { console.error(`[canonicalize] ${changed} file(s) not canonical`); process.exit(1) }
console.error(`[canonicalize] done (${changed} change(s))`)
