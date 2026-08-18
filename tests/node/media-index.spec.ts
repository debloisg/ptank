import { expect, test } from '@playwright/test'
import type { MediaPage } from '../../server/utils/media-index'
import { createMediaIndex } from '../../server/utils/media-index'

// The Studio media index, under the conditions of the platform it actually runs
// on. On Cloudflare Workers a promise left pending when the response is sent is
// not "slow" — the request's I/O context is cancelled and its continuations are
// never scheduled again. It never resolves, never rejects, and never reaches a
// `finally`. Nothing in a dev server reproduces that (Node just keeps running
// the promise), which is why these are unit tests and not e2e ones.
//
// The bug they guard: the media library went permanently empty in production
// while it worked locally. A page load warmed the index off the critical path,
// the warm-up was frozen by the runtime, and the single-flight guard it held was
// released in a `finally` that never ran — so every `/__nuxt_studio/medias/`
// request afterwards awaited a promise that could not settle. The picker sat on
// "No images available in your media library" forever.

/** A listing that never settles: the frozen background work, exactly. */
const FROZEN = new Promise<MediaPage>(() => {})

const BUDGET = 300

test.describe('media index on a runtime that cancels background work', () => {
  test('a frozen warm-up does not wedge the requests that follow', async () => {
    const calls: number[] = []
    let call = 0
    const index = createMediaIndex({
      budget: BUDGET,
      list: () => {
        calls.push(++call)
        // The first listing is the one the warm-up started, and it is frozen.
        return call === 1 ? FROZEN : Promise.resolve({ keys: ['affiche.jpg'] })
      },
    })

    // A page load warms the index. On Workers this is where it dies.
    index.prefetch(undefined)

    // The request that follows must come back — with nothing, which makes the
    // middleware fall through to nuxt-studio's own handler. Slow is fine.
    // Hanging is not: this is the assertion that failed before the fix, by
    // never resolving at all.
    expect(await index.rootListing(undefined)).toBeUndefined()

    // …and the frozen run must not have been left holding the single-flight
    // guard: the next request starts a listing of its own, in its own live
    // context, and gets a real answer.
    expect(await index.rootListing(undefined)).toEqual(['affiche.jpg'])
    expect(calls.length).toBe(2)
  })

  test('background work is registered with waitUntil so the runtime keeps it alive', async () => {
    const registered: Promise<unknown>[] = []
    const index = createMediaIndex({
      budget: BUDGET,
      list: () => Promise.resolve({ keys: ['affiche.jpg'] }),
    })

    index.prefetch(promise => registered.push(promise))
    // Unregistered background work is cancelled at the response on Workers, so
    // the listing has to be handed over — once, not once per page.
    expect(registered.length).toBe(1)

    await index.rootListing(undefined)
    expect(await index.keys(undefined)).toEqual(new Set(['affiche.jpg']))
  })

  test('a listing that fails degrades to a fall-through, not an error', async () => {
    let call = 0
    const index = createMediaIndex({
      budget: BUDGET,
      list: () => (++call === 1 ? Promise.reject(new Error('R2 internal error')) : Promise.resolve({ keys: ['affiche.jpg'] })),
    })

    expect(await index.rootListing(undefined)).toBeUndefined()
    // A blip is retried rather than remembered: an empty index is never cached.
    expect(await index.rootListing(undefined)).toEqual(['affiche.jpg'])
  })
})

test.describe('media index paging', () => {
  test('the root listing is the first page, and the keys are every page', async () => {
    const pages: MediaPage[] = [
      { keys: ['a.jpg', 'b.jpg'], cursor: 'next' },
      { keys: ['c.jpg'] },
    ]
    let call = 0
    const index = createMediaIndex({
      budget: BUDGET,
      list: () => Promise.resolve(pages[call++]!),
    })

    // nuxt-studio's own handler answers the root listing with a single
    // un-paginated `blob.list()`, i.e. the first page — matching it is what
    // keeps this middleware a drop-in.
    expect(await index.rootListing(undefined)).toEqual(['a.jpg', 'b.jpg'])
    await expect.poll(async () => [...await index.keys(undefined)]).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
  })

  test('a cached index answers without listing again', async () => {
    let call = 0
    const index = createMediaIndex({
      budget: BUDGET,
      ttl: 60_000,
      list: () => {
        call++
        return Promise.resolve({ keys: ['affiche.jpg'] })
      },
    })

    await index.rootListing(undefined)
    await index.rootListing(undefined)
    await index.keys(undefined)
    expect(call).toBe(1)
  })
})
