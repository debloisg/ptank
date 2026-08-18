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
// lived key index (server/utils/media-index.ts) and answers the per-key GETs
// from it, in the exact shape nuxt-studio's handler returns.
//
// FALLING THROUGH is always safe, and is what this does whenever the index has
// no answer ready — an unknown key, a listing that failed, a listing still in
// flight when the request's patience ran out. nuxt-studio's own handler then
// does the HEAD (or the listing) itself and 404s if needed. The index is
// therefore never authoritative for absence — only for presence, and only for
// its TTL. A file deleted elsewhere can linger in the picker for that long,
// which is the whole cost of this.
import { blob } from '@nuxthub/blob'
import { getRequestProtocol, useSession } from 'h3'
import type { WaitUntil } from '../utils/media-index'
import { createMediaIndex } from '../utils/media-index'
// joinURL/withLeadingSlash come from Nitro's auto-imported ufo preset — `ufo`
// itself is a transitive dependency here, not a direct one, so importing it by
// name does not type-resolve under pnpm's strict node_modules.

const MEDIA_ENDPOINT = '/__nuxt_studio/medias/'
// nuxt-studio addresses the bucket through a virtual collection name and uses
// `:` as its key separator (unstorage), so both spellings reach us.
const VIRTUAL_COLLECTION = /^public-assets[:/]/
// Derived files, generated per image by server/plugins/studio-media-variants.ts
// (and, for the existing corpus, scripts/generate-image-variants.mjs).
const GENERATED_RENDITION = /-(?:800|ph)\.webp$/i

// Listing this bucket costs ~1 s on Cloudflare and 7-17 s through wrangler's
// remote-bindings proxy in dev, so a request's patience is set per environment:
// dev would otherwise give up on a listing that was about to land and fall back
// to the slow path it exists to avoid.
const REQUEST_BUDGET = import.meta.dev ? 60_000 : 8_000

// The media prefix is build-time config (nuxt.config.ts studio.media.prefix) and
// the same for every request, but it is only readable from an event — so the
// first request that has one hands it to the index, which is otherwise a
// process-wide singleton.
let PREFIX = 'images'

const mediaIndex = createMediaIndex({
  budget: REQUEST_BUDGET,
  async list({ cursor, limit }) {
    const result = await blob.list({ prefix: `${PREFIX}/`, cursor, limit })
    return {
      keys: result.blobs.map(item => item.pathname.slice(`${PREFIX}/`.length)),
      cursor: result.hasMore ? result.cursor : undefined,
    }
  },
})

export default defineEventHandler(async (event) => {
  if (event.method !== 'GET' || !event.path.startsWith('/__nuxt_studio/')) return

  // The panel asks for its meta before it asks for any media, so this is the
  // moment to start building the index — off the critical path, so the first
  // editor to open the media tab does not wait for the listing.
  //
  // `waitUntil` is not optional here: on Workers the listing would otherwise be
  // cancelled the instant this response is sent.
  if (event.path.startsWith('/__nuxt_studio/meta')) {
    if (await isStudioEditor(event)) {
      PREFIX = mediaConfig(event).prefix
      mediaIndex.prefetch(waitUntil(event))
    }
    return
  }

  if (!event.path.startsWith(MEDIA_ENDPOINT)) return

  const path = decodeURIComponent(event.path.slice(MEDIA_ENDPOINT.length).split('?')[0]!)
  if (!path) return

  if (!await isStudioEditor(event)) return

  const { prefix, publicUrl } = mediaConfig(event)
  PREFIX = prefix

  // The ROOT listing is the first thing the client asks for and the answer
  // everything else waits on: until it lands the picker says "No images
  // available in your media library". nuxt-studio's handler pays a fresh
  // `blob.list()` for it on every page load, so it is served from the cached
  // first page instead.
  //
  // The FIRST PAGE specifically, not the whole index: that is exactly the set
  // nuxt-studio's own un-paginated call returns. Sub-folder listings are rare
  // and fall through to the real handler.
  //
  // The listing is also where the library's SIZE is decided, and size is what
  // makes it slow: the client fetches metadata for every key it is handed, one
  // request each. Two thirds of this bucket are the `-800`/`-ph` renditions the
  // site generates for each image — files no editor should ever pick (picking
  // one puts a derived file in the content and leaves the renderer looking for
  // `foo-800-800.webp`). Dropping them from the LISTING alone cuts the cold
  // library to a third without hiding anything real: every key is still served
  // individually, so content that already points at a rendition still resolves.
  if (isRootListing(path)) {
    const listing = await mediaIndex.rootListing(waitUntil(event))
    if (!listing) return

    setResponseHeader(event, 'cache-control', 'private, max-age=60')
    return listing.filter(key => !GENERATED_RENDITION.test(key))
  }
  if (path.endsWith('/') || path.endsWith(':')) return

  const blobPath = path.replace(VIRTUAL_COLLECTION, '').replace(/:/g, '/')
  const keys = await mediaIndex.keys(waitUntil(event))
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

/** `public-assets:`, `:` and `/` all mean "everything under the media prefix". */
function isRootListing(path: string) {
  return /^(?:public-assets)?[:/]$/.test(path)
}

/**
 * Cloudflare's `ctx.waitUntil`, wired into the event context by Nitro's
 * cloudflare preset. Undefined under plain `nuxt dev` (Node), where a detached
 * promise keeps running by itself and nothing needs registering.
 */
function waitUntil(event: Parameters<Parameters<typeof defineEventHandler>[0]>[0]): WaitUntil {
  const registered = (event.context as { waitUntil?: WaitUntil }).waitUntil
  return typeof registered === 'function' ? registered : undefined
}

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
