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
// TWO hooks, verified against the deployed Worker (not just dev, where the
// robots module masks everything with its own dev-noindex header):
//   - 'error' is what actually fires for the SSR'd error page and the JSON
//     error variant — nitro's error handler sends the response itself and
//     never reaches beforeResponse;
//   - beforeResponse stays for handlers that set an error STATUS without
//     throwing (nothing does today, but it costs one integer comparison).
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (_error, { event }) => {
    if (event) {
      setResponseHeader(event, 'x-robots-tag', 'noindex')
    }
  })
  nitroApp.hooks.hook('beforeResponse', (event) => {
    if (getResponseStatus(event) >= 400) {
      setResponseHeader(event, 'x-robots-tag', 'noindex')
    }
  })
})
