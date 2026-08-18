// The key index behind server/middleware/studio-media-index.ts, kept separate
// from the middleware so it can be driven without a Nitro server: the failure
// it exists to survive (see BACKGROUND WORK below) only happens on Cloudflare,
// which is the one place an end-to-end test cannot reach.
//
// BACKGROUND WORK IS NOT FREE ON WORKERS. A `void somethingAsync()` left running
// when the response is sent does not finish there — the runtime cancels the
// request's I/O context and the pending continuations are simply never
// scheduled. The promise neither resolves NOR rejects: no `catch`, no `finally`.
// A single-flight guard released in a `finally` is therefore released never, and
// every later request that awaits it hangs for good. That is what took the media
// library down in production while dev (plain Node, where a detached promise
// just keeps running) looked perfect.
//
// Two rules follow, and this module exists to hold them in one place:
//   1. anything meant to outlive the response is handed to `waitUntil`;
//   2. nothing is ever awaited without a deadline — a wait that expires falls
//      back to nuxt-studio's own handler, which is slow but always correct.

/** One page of blob keys, already stripped of the media prefix. */
export interface MediaPage {
  keys: string[]
  cursor?: string
}

export interface MediaIndexOptions {
  /** Lists one page of keys. Rejections are absorbed: a failed listing degrades to a fall-through. */
  list: (options: { cursor?: string, limit: number }) => Promise<MediaPage>
  /** How long a cached index is trusted before a background refresh is kicked off. */
  ttl?: number
  /** How long a REQUEST will wait for a cold listing before giving up on it. */
  budget?: number
  /** Keys per listing page. */
  pageSize?: number
  /** Guard against a pathological cursor loop, not a real limit. */
  maxPages?: number
  now?: () => number
}

/**
 * Registers work that must survive the response. On Cloudflare this is
 * `event.context.waitUntil`; under plain Node there is nothing to register with
 * and the promise keeps running on its own.
 */
export type WaitUntil = ((promise: Promise<unknown>) => void) | undefined

export interface MediaIndex {
  /** Every key known so far — empty rather than late, if the listing outruns the budget. */
  keys: (waitUntil?: WaitUntil) => Promise<Set<string>>
  /**
   * The first page of keys, which is exactly what nuxt-studio's own
   * un-paginated listing returns. `undefined` means "no answer in time — let the
   * real handler do it".
   */
  rootListing: (waitUntil?: WaitUntil) => Promise<string[] | undefined>
  /** Warms the index off the critical path. Safe to call on every request. */
  prefetch: (waitUntil?: WaitUntil) => void
}

const DEFAULTS = {
  ttl: 10 * 60_000,
  budget: 8_000,
  pageSize: 1000,
  maxPages: 20,
}

export function createMediaIndex(options: MediaIndexOptions): MediaIndex {
  const { list } = options
  const ttl = options.ttl ?? DEFAULTS.ttl
  const budget = options.budget ?? DEFAULTS.budget
  const pageSize = options.pageSize ?? DEFAULTS.pageSize
  const maxPages = options.maxPages ?? DEFAULTS.maxPages
  const now = options.now ?? Date.now

  let index: { keys: Set<string>, rootListing: string[], expires: number } | undefined
  // Single-flight, and deliberately only over the FIRST PAGE. The rest of the
  // pagination is background work: if it is frozen mid-flight (see the header),
  // nothing is waiting on it and nothing has to be released for the next request
  // to make progress.
  let firstPage: Promise<void> | undefined

  /** Resolves when the first page has landed, or when `budget` runs out — whichever comes first. */
  async function warm(waitUntil: WaitUntil): Promise<void> {
    if (index && index.expires > now()) return
    if (index) {
      // Stale but usable: refresh behind the request rather than in front of it.
      void deadline(start(waitUntil), budget)
      return
    }
    await deadline(start(waitUntil), budget)
  }

  function start(waitUntil: WaitUntil): Promise<void> {
    if (firstPage) return firstPage

    let landed!: () => void
    firstPage = new Promise<void>((resolve) => {
      landed = resolve
    })
    // Captured before the await below: a later timeout must only ever clear the
    // run it belongs to, never a fresh one started in the meantime.
    const own = firstPage

    const task = (async () => {
      const keys = new Set<string>()
      let rootListing: string[] = []
      try {
        let cursor: string | undefined
        let page = 0
        do {
          const result = await list({ cursor, limit: pageSize })
          for (const key of result.keys) keys.add(key)
          // The first page IS what nuxt-studio's own un-paginated listing
          // returns, so it is what the root listing must answer with.
          if (!page) rootListing = result.keys
          // Never cache an empty result: a blip should be retried, not remembered.
          if (keys.size) index = { keys, rootListing, expires: now() + ttl }
          if (!page) release(own, landed)
          cursor = result.cursor
        } while (cursor && ++page < maxPages)
      }
      catch (error) {
        // Falling through to nuxt-studio's per-key HEADs is slow, not broken —
        // the right way to degrade when the bucket answers with an error.
        console.warn('[studio-media-index] listing failed, falling back to per-key HEADs:', error)
      }
      finally {
        release(own, landed)
      }
    })()

    // THE FIX. Without this the listing is abandoned the moment the response is
    // sent and its remaining pages are never fetched — on Workers permanently,
    // mid-promise, with no error anywhere.
    waitUntil?.(task)
    return firstPage
  }

  function release(own: Promise<void>, landed: () => void) {
    if (firstPage === own) firstPage = undefined
    landed()
  }

  /**
   * Waits at most `ms`. On expiry the run is disowned so the NEXT request starts
   * a listing of its own: a frozen promise can never settle, so a guard that is
   * only cleared by the run itself would wedge this isolate for good.
   */
  async function deadline(promise: Promise<void>, ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = Symbol('expired')
    const timeout = new Promise<typeof expired>((resolve) => {
      timer = setTimeout(() => resolve(expired), ms)
    })
    try {
      if (await Promise.race([promise.then(() => undefined), timeout]) === expired) {
        if (firstPage === promise) firstPage = undefined
      }
    }
    finally {
      clearTimeout(timer)
    }
  }

  return {
    async keys(waitUntil) {
      await warm(waitUntil)
      return index?.keys ?? new Set<string>()
    },
    async rootListing(waitUntil) {
      await warm(waitUntil)
      return index?.rootListing.length ? index.rootListing : undefined
    },
    prefetch(waitUntil) {
      if (index && index.expires > now()) return
      void start(waitUntil)
    },
  }
}
