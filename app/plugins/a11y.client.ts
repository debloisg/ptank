// Dev-only accessibility auditing. Runs axe-core (the engine behind the
// nuxt-a11y module) after every client navigation and logs WCAG violations to
// the browser console. Excluded from the production bundle entirely: the guard
// tree-shakes and axe-core is loaded via dynamic import inside it.
export default defineNuxtPlugin(() => {
  if (!import.meta.dev) return

  const router = useRouter()

  const audit = async () => {
    const { default: axe } = await import('axe-core')
    // Wait a tick so the incoming page has painted before scanning the DOM.
    await new Promise(r => requestAnimationFrame(() => r(null)))
    const { violations } = await axe.run(document, {
      resultTypes: ['violations'],
    })
    if (!violations.length) return
    console.groupCollapsed(
      `%c♿ a11y%c ${violations.length} violation(s) on ${router.currentRoute.value.fullPath}`,
      'color:#fff;background:#b45309;padding:1px 5px;border-radius:3px',
      'color:inherit',
    )
    for (const v of violations) {
      console.warn(`[${v.impact}] ${v.id} — ${v.help}\n${v.helpUrl}`, v.nodes.map(n => n.target))
    }
    console.groupEnd()
  }

  // Initial load + every subsequent route.
  router.afterEach(() => { void audit() })
  onNuxtReady(() => { void audit() })
})
