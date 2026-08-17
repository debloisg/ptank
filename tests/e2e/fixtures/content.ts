import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * Studio in dev mode writes straight to `content/**` on disk — there is no
 * draft to discard (that is also why it shows no Review/Publish button). So any
 * spec that edits a document has to put the file back itself.
 */
export class ContentFile {
  private original: string | undefined
  readonly path: string

  constructor(repoRelative: string) {
    this.path = fileURLToPath(new URL(`../../../${repoRelative}`, import.meta.url))
  }

  async snapshot() {
    this.original = await readFile(this.path, 'utf8')
  }

  async read() {
    return readFile(this.path, 'utf8')
  }

  async restore(baseURL = 'http://localhost:3000') {
    if (this.original === undefined) return
    const current = await readFile(this.path, 'utf8')
    if (current === this.original) return

    await writeFile(this.path, this.original, 'utf8')
    // Writing under content/ makes the dev server rebuild the collection; a
    // navigation started during that window dies with ERR_ABORTED, so hold
    // until it answers again.
    await waitForServer(baseURL)
  }
}

async function waitForServer(baseURL: string, timeout = 60_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseURL, { signal: AbortSignal.timeout(5_000) })
      if (response.ok) return
    }
    catch { /* server mid-restart */ }
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
}
