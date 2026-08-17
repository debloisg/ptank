// Makes Nuxt Studio's media library appear in seconds instead of a minute.
//
// WHY: Studio's client builds its library by asking the media endpoint for the
// key listing and then fetching metadata for EVERY key, one request each. This
// bucket holds ~2.4k objects (every image plus its -800/-ph renditions, the
// archive corpus included), and nuxt-studio's handler answers each one with a
// `blob.head()` — a round-trip to R2, ~100 ms, which in dev also crosses
// wrangler's remote-bindings proxy. Cold (a fresh browser profile, cleared site
// data, a colleague's laptop) that is a minute or more of an empty-looking
// "MEDIA 0" tab and a picker with no images in it, plus a request storm that
// starves the dev server for everything else.
//
// WHAT: none of that metadata actually needs a HEAD. The handler builds it from
// the key itself — `joinURL(publicUrl, prefix, fsPath)` — and only touches R2 to
// decide whether the key exists (`meta.url` is unset for R2 blobs). One `list()`
// gives the same answer for every key at once, so this middleware keeps a short
// lived key index and answers the per-key GETs from it, in the exact shape
// nuxt-studio's handler returns.
//
// FALLING THROUGH is always safe: any key the index does not know (a fresh
// upload, a typo) is left to nuxt-studio's own handler, which does the HEAD and
// 404s if needed. The index is therefore never authoritative for absence — only
// for presence, and only for CACHE_TTL. A file deleted elsewhere can linger in
// the picker for that long, which is the whole cost of this.
import { blob } from '@nuxthub/blob'
import { getRequestProtocol, useSession } from 'h3'
// joinURL/withLeadingSlash come from Nitro's auto-imported ufo preset — `ufo`
// itself is a transitive dependency here, not a direct one, so importing it by
// name does not type-resolve under pnpm's strict node_modules.

const MEDIA_ENDPOINT = '/__nuxt_studio/medias/'
// nuxt-studio addresses the bucket through a virtual collection name and uses
// `:` as its key separator (unstorage), so both spellings reach us.
const VIRTUAL_COLLECTION = /^public-assets[:/]/

// Listing ~2.4k objects costs 7-17 s through wrangler's remote-bindings proxy,
// so the index is kept for a good while and refreshed in the background: a stale
// key set is still correct for everything it contains, and anything it misses
// falls through to nuxt-studio's handler.
const CACHE_TTL = 10 * 60_000
const PAGE_SIZE = 1000
// Bucket is ~2.4k objects; the cap is a guard against a pathological cursor
// loop, not a real limit.
const MAX_PAGES = 20

let index: { keys: Set<string>, rootListing: string[], expires: number } | undefined
let inflight: Promise<Set<string>> | undefined

/** `public-assets:`, `:` and `/` all mean "everything under the media prefix". */
function isRootListing(path: string) {
  return /^(?:public-assets)?[:/]$/.test(path)
}

export default defineEventHandler(async (event) => {
  if (event.method !== 'GET' || !event.path.startsWith('/__nuxt_studio/')) return

  // The panel asks for its meta before it asks for any media, so this is the
  // moment to start building the index — off the critical path, so the first
  // editor to open the media tab does not wait for the listing.
  if (event.path.startsWith('/__nuxt_studio/meta')) {
    if (await isStudioEditor(event)) void mediaKeys(mediaConfig(event).prefix)
    return
  }

  if (!event.path.startsWith(MEDIA_ENDPOINT)) return

  const path = decodeURIComponent(event.path.slice(MEDIA_ENDPOINT.length).split('?')[0]!)
  if (!path) return

  if (!await isStudioEditor(event)) return

  // The ROOT listing is the first thing the client asks for and the answer
  // everything else waits on: until it lands the picker says "No images
  // available in your media library". nuxt-studio's handler pays a fresh
  // `blob.list()` for it on every page load — 8-17 s here, through wrangler's
  // remote-bindings proxy — so it is served from the cached first page instead.
  //
  // The FIRST PAGE specifically, not the whole index: that is exactly the set
  // nuxt-studio's own un-paginated call returns, and the client fetches
  // metadata for every key it is handed. Sub-folder listings are rare and fall
  // through to the real handler.
  if (isRootListing(path)) {
    const { prefix } = mediaConfig(event)
    await mediaKeys(prefix)
    if (!index?.rootListing.length) return

    setResponseHeader(event, 'cache-control', 'private, max-age=60')
    return index.rootListing
  }
  if (path.endsWith('/') || path.endsWith(':')) return

  const { prefix, publicUrl } = mediaConfig(event)
  const blobPath = path.replace(VIRTUAL_COLLECTION, '').replace(/:/g, '/')
  const keys = await mediaKeys(prefix)
  if (!keys.has(blobPath)) return

  // Private and short: the editor asks for hundreds of these per session, and
  // they are derived from the key, so a reload should not re-ask. Never shared
  // (it is editor-only data behind Cloudflare Access in production).
  setResponseHeader(event, 'cache-control', 'private, max-age=300')

  const fsPath = `/${blobPath}`
  return {
    id: path,
    fsPath,
    extension: fsPath.split('.').pop(),
    stem: fsPath.split('.').slice(0, -1).join('.'),
    path: joinSegments(publicUrl, prefix, fsPath),
  }
})

/**
 * `joinURL` without the import: `ufo` is a transitive dependency here, not a
 * direct one, so importing it by name does not type-resolve under pnpm's strict
 * node_modules — and the response shape below must match nuxt-studio's own
 * handler EXACTLY, so a subtly different join is not an option. Trailing
 * slashes are the failure that matters: `…/Affiche.jpg/` is what the picker
 * would then write into the content, and it 404s.
 */
function joinSegments(...segments: string[]) {
  const joined = segments
    .filter(Boolean)
    .map(segment => segment.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
  // A root-relative publicUrl ('/') must stay root-relative.
  const rootRelative = segments[0]?.startsWith('/') && !/^[a-z][a-z\d+\-.]*:/i.test(segments[0])
  return rootRelative ? `/${joined}` : joined
}

/**
 * Same gate as nuxt-studio's `requireStudioAuth`: open in dev, a valid Studio
 * session in production. Anything else falls through to the real handler rather
 * than being answered here, so this can never widen access.
 */
async function isStudioEditor(event: Parameters<Parameters<typeof defineEventHandler>[0]>[0]) {
  if (import.meta.dev) return true

  const password = (useRuntimeConfig(event) as { studio?: { auth?: { sessionSecret?: string } } })
    .studio?.auth?.sessionSecret
  if (!password) return false

  const session = await useSession<{ user?: unknown }>(event, {
    name: 'studio-session',
    password,
    cookie: { secure: getRequestProtocol(event) === 'https', path: '/' },
  })
  return Boolean(session?.data?.user)
}

function mediaConfig(event: Parameters<Parameters<typeof defineEventHandler>[0]>[0]) {
  return useRuntimeConfig(event).public.studio.media as { prefix: string, publicUrl: string }
}

/**
 * Every key under the media prefix, so far.
 *
 * Two things keep this off the critical path:
 *   * stale-while-revalidate — an expired index is served as is and refreshed
 *     behind the request;
 *   * incremental publication — the listing is paginated (1000 keys a page,
 *     ~12 s each through wrangler's remote proxy for this bucket), and each page
 *     is published as it lands rather than after the last one.
 *
 * A partial index is still correct: it is only ever consulted for PRESENCE, and
 * a key it does not have yet falls through to nuxt-studio's own handler.
 */
async function mediaKeys(prefix: string): Promise<Set<string>> {
  if (index) {
    if (index.expires <= Date.now()) void refresh(prefix)
    return index.keys
  }
  return refresh(prefix)
}

/** Resolves as soon as the FIRST page is indexed; the rest streams in after. */
function refresh(prefix: string): Promise<Set<string>> {
  // Single-flight: the client fires hundreds of metadata requests in parallel,
  // and each one starting its own listing would be worse than the problem being
  // solved.
  if (inflight) return inflight

  let publishFirstPage!: (keys: Set<string>) => void
  inflight = new Promise<Set<string>>((resolve) => {
    publishFirstPage = resolve
  })

  void (async () => {
    const keys = new Set<string>()
    let rootListing: string[] = []
    const strip = prefix ? `${prefix}/`.length : 0
    try {
      let cursor: string | undefined
      let page = 0
      do {
        const result = await blob.list({
          prefix: prefix ? `${prefix}/` : undefined,
          cursor,
          limit: PAGE_SIZE,
        })
        const page_ = result.blobs.map(item => item.pathname.slice(strip))
        for (const key of page_) keys.add(key)
        // The first page IS what nuxt-studio's own un-paginated `blob.list()`
        // returns, so it is what the root listing must answer with — byte for
        // byte the same media library the editor had before this middleware.
        if (!page) rootListing = page_
        // Never cache an empty result: a blip should be retried, not remembered.
        if (keys.size) index = { keys, rootListing, expires: Date.now() + CACHE_TTL }
        publishFirstPage(keys)
        cursor = result.hasMore ? result.cursor : undefined
      } while (cursor && ++page < MAX_PAGES)
    }
    catch (error) {
      // Falling through to per-key HEADs is slow, not broken — the right way to
      // degrade when wrangler's remote proxy answers `internal error` under
      // load, as it does in dev.
      console.warn('[studio-media-index] listing failed, falling back to per-key HEADs:', error)
    }
    finally {
      publishFirstPage(keys)
      inflight = undefined
    }
  })()

  return inflight
}
