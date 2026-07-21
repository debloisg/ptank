// Sticky "edit mode" banner shown ONLY to a logged-in Studio editor, detected via the
// non-httpOnly `studio-session-check` cookie that nuxt-studio sets for the client
// (server/utils/session.ts). Invisible to the public — no cookie, no banner — and it
// never redirects, so public visitors are never bounced to /_studio.
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
  label.textContent = 'Mode édition —'

  const link = document.createElement('a')
  link.href = STUDIO_ROUTE
  link.textContent = 'Ouvrir le Studio'
  link.style.cssText = 'color:#7dd3fc;text-decoration:underline'

  bar.append(label, link)
  document.body.prepend(bar)
})
