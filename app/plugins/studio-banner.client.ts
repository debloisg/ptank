// Sticky "edit mode" banner shown ONLY to a logged-in Studio editor, detected via the
// non-httpOnly `studio-session-check` cookie that nuxt-studio sets for the client
// (server/utils/session.ts). Invisible to the public — no cookie, no banner — and it
// never redirects, so public visitors are never bounced to /_studio.
//
// Two contexts, because the same page runs in both:
//  • Public site (top window): offer "Ouvrir le Studio" to jump into the editor.
//  • Inside Studio's live-preview iframe (window.top !== self): "Ouvrir le Studio" is
//    nonsensical (already open), so instead offer a RESET that wipes local pending
//    changes and resyncs with the latest published version — the escape hatch for the
//    "content on GitHub differs from your website version" conflict.
export default defineNuxtPlugin(() => {
  const STUDIO_ROUTE = '/_studio'
  if (window.location.pathname.startsWith(STUDIO_ROUTE)) return

  const loggedIn = document.cookie
    .split('; ')
    .some(c => c.startsWith('studio-session-check='))
  if (!loggedIn) return

  // The site page is embedded as an iframe by the Studio editor's preview pane.
  const inStudioPreview = window.self !== window.top

  const bar = document.createElement('div')
  bar.setAttribute('data-studio-banner', '')
  bar.style.cssText = [
    'position:sticky',
    'top:0',
    'z-index:99999',
    'display:flex',
    'gap:.5rem',
    'align-items:center',
    'justify-content:center',
    'padding:.5rem 1rem',
    'font:600 14px/1.4 system-ui,-apple-system,sans-serif',
    'background:#0f172a',
    'color:#fff',
  ].join(';')

  const label = document.createElement('span')
  const link = document.createElement('a')
  link.style.cssText = 'color:#7dd3fc;text-decoration:underline;cursor:pointer'

  if (inStudioPreview) {
    label.textContent = 'Aperçu Studio —'
    link.textContent = 'Réinitialiser (annuler les modifications en attente)'
    link.addEventListener('click', (e) => {
      e.preventDefault()
      void resetStudio()
    })
  } else {
    label.textContent = 'Mode édition —'
    link.textContent = 'Ouvrir le Studio'
    link.href = STUDIO_ROUTE
  }

  bar.append(label, link)
  document.body.prepend(bar)
})

// Wipe Studio's client-side state so the editor re-pulls the latest published content
// and GitHub base from scratch. Drafts live in IndexedDB (draftItem/DraftBase stores)
// alongside the local @nuxt/content preview DB; the session lives in cookies, which we
// deliberately leave untouched so the editor stays logged in after the reload.
async function resetStudio() {
  const ok = window.confirm(
    'Supprimer toutes les modifications non publiées et resynchroniser avec la '
    + 'dernière version publiée ?\n\nCette action est irréversible.',
  )
  if (!ok) return

  try {
    // indexedDB.databases() is unsupported in Firefox; there we fall back to a plain
    // reload, which still re-fetches base content once the stale draft is bypassed.
    if (typeof indexedDB !== 'undefined' && 'databases' in indexedDB) {
      const dbs = await indexedDB.databases()
      await Promise.all(
        dbs.map(d => d.name && new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(d.name!)
          req.onsuccess = req.onerror = req.onblocked = () => resolve()
        })),
      )
    }
  } catch { /* best-effort */ }

  try { localStorage.clear() } catch { /* ignore */ }
  try { sessionStorage.clear() } catch { /* ignore */ }

  // Reload the whole Studio app (top window), not just the preview iframe.
  try { (window.top ?? window).location.reload() }
  catch { window.location.reload() }
}
