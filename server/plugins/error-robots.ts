// Stamps X-Robots-Tag: noindex on every error response.
//
// The robots module's middleware runs at the START of the request and writes
// the site-wide `index, follow` header before anyone knows the page will 404 —
// so a dead URL actively invites crawlers to keep it in the index and keep
// re-fetching it. It can't be fixed from app/error.vue either: that component
// renders under the internal /__nuxt_error path, a different H3 event from the
// one whose headers the visitor receives (and the robots context middleware
// skips /__ paths, so useRobotsRule() crashes there — the error page sets the
// robots META tag only).
//
// beforeResponse fires on the ORIGINAL event, after the status is known and
// last-writer-wins on the header. Covers the JSON error variant too.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event) => {
    if (getResponseStatus(event) >= 400) {
      setResponseHeader(event, 'x-robots-tag', 'noindex')
    }
  })
})
