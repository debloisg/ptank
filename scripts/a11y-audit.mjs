// Headless accessibility audit: runs axe-core against the prerendered HTML in
// .output/public and prints WCAG violations. Complements the in-browser dev
// plugin (app/plugins/a11y.client.ts) with a CI-friendly, no-browser check.
//
// Run:  pnpm build && node scripts/a11y-audit.mjs
// Note: color-contrast is skipped — jsdom doesn't render, so it can't measure
// contrast reliably. Verify contrast in a real browser (the dev plugin does).
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { JSDOM, VirtualConsole } from 'jsdom'

const require = createRequire(import.meta.url)
const axeSource = readFileSync(require.resolve('axe-core'), 'utf8')

// Representative sample: home, prose page, one article, a section list, contact.
const pages = [
  ['Home', '.output/public/index.html'],
  ['À propos (prose + images)', '.output/public/a-propos.html'],
  ['Article', '.output/public/actualites/reprise-entrainements.html'],
  ['Section list', '.output/public/actualites.html'],
  ['Contact', '.output/public/contact.html'],
]

async function audit(file) {
  const html = readFileSync(file, 'utf8')
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(), // swallow page console noise
  })
  const { window } = dom
  const s = window.document.createElement('script')
  s.textContent = axeSource
  window.document.head.appendChild(s)
  const { violations } = await window.axe.run(window.document, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false } },
  })
  window.close()
  return violations
}

let total = 0
for (const [label, file] of pages) {
  let violations
  try {
    violations = await audit(file)
  } catch (e) {
    console.log(`\n⚠️  ${label} (${file}): audit failed — ${e.message}`)
    continue
  }
  if (!violations.length) {
    console.log(`\n✅ ${label}: no violations`)
    continue
  }
  total += violations.length
  console.log(`\n❌ ${label}: ${violations.length} violation(s)`)
  for (const v of violations) {
    console.log(`   [${v.impact}] ${v.id} — ${v.help}`)
    console.log(`      ${v.helpUrl}`)
    for (const n of v.nodes.slice(0, 4)) console.log(`      → ${n.target.join(' ')}`)
    if (v.nodes.length > 4) console.log(`      … +${v.nodes.length - 4} more`)
  }
}
console.log(`\n──\nTotal violations across sampled pages: ${total} (color-contrast not evaluated — check in a browser)`)
