import { Worker } from 'node:worker_threads'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '../log/logger'

/**
 * Talks to the search worker (`searchWorker.ts`), which owns the FTS index on a thread of its own.
 *
 * Started lazily and kept: spinning a worker up costs a SQLite open, which is not worth paying per
 * keystroke-pause. If it dies, the next query starts another — a search failing is a blank result,
 * never a broken app.
 */
export class SearchClient {
  private worker: Worker | null = null
  /** Set once a worker has failed, so later searches fall back without retrying it each time. */
  private unavailable = false
  private nextId = 1
  private pending = new Map<number, (ids: string[] | null) => void>()

  constructor(private readonly dbPath: string) {}

  private ensure(): Worker | null {
    if (this.unavailable) return null
    if (this.worker !== null) return this.worker
    try {
      // Resolved against this bundle's own location: electron-vite emits the worker beside it (see
      // the `main` build inputs in electron.vite.config.ts).
      const here = dirname(fileURLToPath(import.meta.url))
      const worker = new Worker(join(here, 'searchWorker.js'), { workerData: { dbPath: this.dbPath } })
      worker.on('message', (r: { id: number; ids?: string[] }) => {
        const resolve = this.pending.get(r.id)
        if (resolve === undefined) return
        this.pending.delete(r.id)
        resolve(r.ids ?? [])
      })
      const fail = (why: string): void => {
        log.warn('search', 'worker stopped', { why })
        this.worker = null
        // `null`, not `[]`: anything still waiting needs to fall back to an in-process search, and
        // an empty array would tell the caller the search ran and matched nothing.
        for (const [, resolve] of this.pending) resolve(null)
        this.pending.clear()
        // One failure is enough. Without this every later query pays another doomed round trip
        // before falling back — and the common cause (no worker file beside the bundle) will not
        // fix itself.
        this.unavailable = true
      }
      worker.on('error', (e: unknown) => {
        fail(e instanceof Error ? e.message : String(e))
      })
      worker.on('exit', (code) => { if (code !== 0) fail(`exit ${String(code)}`) })
      worker.unref()
      this.worker = worker
      return worker
    } catch (error) {
      log.warn('search', 'worker failed to start', { error })
      this.unavailable = true
      return null
    }
  }

  /**
   * Resolves with the ids that matched, or `null` if there is no worker to ask.
   *
   * `null` rather than an empty list, because the two mean opposite things: "nothing matched" is a
   * result, "the search never ran" is not, and quietly returning the former for the latter would
   * show an empty sidebar and call it an answer. The caller falls back to searching in-process.
   */
  async search(query: string, opts: { content: boolean; notes: boolean }): Promise<string[] | null> {
    const worker = this.ensure()
    if (worker === null) return null
    const id = this.nextId++
    return new Promise<string[] | null>((resolve) => {
      this.pending.set(id, resolve)
      worker.postMessage({ id, query, content: opts.content, notes: opts.notes })
    })
  }

  async close(): Promise<void> {
    const worker = this.worker
    this.worker = null
    if (worker !== null) await worker.terminate()
  }
}
