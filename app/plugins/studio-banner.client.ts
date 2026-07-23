// Sticky "edit mode" banner shown ONLY to a logged-in Studio editor, detected via the
// non-httpOnly `studio-session-check` cookie that nuxt-studio sets for the client
// (server/utils/session.ts). Invisible to the public — no cookie, no banner — and it
// never redirects, so public visitors are never bounced to /_studio.
//
// IMPORTANT: nuxt-studio has NO preview iframe. Its activation plugin mounts a
// <nuxt-studio> web component onto the site's own <body> and overlays the editor on the
// live page (dist/.../plugins/studio.client.js + utils/activation.js), so editor and
// site share one window — window.self === window.top always. "Am I in Studio?" is
// therefore detected by the presence of that <nuxt-studio> element (or the
// window.useStudioHost hook activation sets), which appears ASYNCHRONOUSLY after this
// plugin runs, so we also watch for it. While Studio is active, "Ouvrir le Studio" is
// nonsensical, so the banner offers a RESET that wipes local pending changes and
// resyncs with the latest published version — the escape hatch for the "content on
// GitHub differs from your website version" conflict.
export default defineNuxtPlugin(() => {
  const STUDIO_ROUTE = '/_studio'
  if (window.location.pathname.startsWith(STUDIO_ROUTE)) return

  const loggedIn = document.cookie
    .split('; ')
    .some(c => c.startsWith('studio-session-check='))
  if (!loggedIn) return

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

  // Studio not yet active: offer a jump into the full editor route.
  function renderOpenMode() {
    label.textContent = 'Mode édition —'
    link.textContent = 'Ouvrir le Studio'
    link.onclick = null
    link.href = STUDIO_ROUTE
  }

  // Studio active/overlaid: "open" is pointless — offer the reset instead.
  function renderResetMode() {
    label.textContent = 'Studio actif —'
    link.textContent = 'Réinitialiser (annuler les modifications en attente)'
    link.removeAttribute('href')
    link.onclick = (e) => {
      e.preventDefault()
      void resetStudio()
    }
  }

  const studioActive = () =>
    !!document.querySelector('nuxt-studio')
    || typeof (window as unknown as { useStudioHost?: unknown }).useStudioHost === 'function'

  if (studioActive()) {
    renderResetMode()
  }
  else {
    renderOpenMode()
    // Activation is async (session fetch + dynamic import of the editor); flip to reset
    // mode the moment <nuxt-studio> is appended to the body.
    const obs = new MutationObserver(() => {
      if (studioActive()) {
        renderResetMode()
        obs.disconnect()
      }
    })
    obs.observe(document.body, { childList: true })
    // Stop watching after 10s so we never leave a dangling observer running.
    setTimeout(() => obs.disconnect(), 10_000)
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

  // Reload the whole page so Studio re-initialises against the freshly published state.
  window.location.reload()
}
