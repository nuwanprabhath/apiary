import { parentPort, workerData } from 'node:worker_threads'
import { SearchIndex } from './searchIndex'

/**
 * The content search, run off the main process's main thread.
 *
 * `better-sqlite3` is synchronous by design, so every FTS query used to run on the thread that
 * also routes window input. A slow one did not merely delay results — it froze typing in every
 * window, because a keystroke reaches a renderer *through* main. Measured on a real library: a
 * one-character query took 7.7 seconds, and the keystrokes typed during it arrived afterwards all
 * at once. The renderer was idle the whole time, which is why it read as a rendering problem.
 *
 * `searchIndex.ts`'s prefix guard makes that particular query cheap, but "no query is ever slow"
 * is not a property a search index can promise as a library grows. This is the structural half:
 * a search may now take as long as it takes, and the cost is only that the results are late.
 *
 * Read-only, and its own connection: the index is WAL, so reading here never blocks the indexing
 * writes happening on the main thread.
 */
interface Request { id: number; query: string; notes: boolean; content: boolean }
interface Response { id: number; ids?: string[]; error?: string }

const index = new SearchIndex((workerData as { dbPath: string }).dbPath)

parentPort?.on('message', (req: Request) => {
  const reply = (r: Response): void => { parentPort?.postMessage(r) }
  try {
    const ids = new Set<string>()
    if (req.content) for (const hit of index.search(req.query)) ids.add(hit.sessionId)
    if (req.notes) for (const hit of index.searchNotes(req.query)) ids.add(hit.sessionId)
    reply({ id: req.id, ids: [...ids] })
  } catch (error) {
    // Search is an enhancement to the sidebar, never a reason for it to fail — the caller turns
    // this into an empty result, the same as the synchronous version did.
    reply({ id: req.id, error: error instanceof Error ? error.message : String(error) })
  }
})
