import { parentPort, workerData } from 'node:worker_threads'
import { errorMessage } from '@shared/errors'
import { SearchIndex } from './searchIndex'

/**
 * The content search, run off the main process's main thread.
 *
 * `better-sqlite3` is synchronous, so an FTS query on the main thread freezes typing in every
 * window: a keystroke reaches a renderer *through* main. Measured on a real library: a
 * one-character query took 7.7 seconds, and the keystrokes typed during it arrived afterwards all
 * at once.
 *
 * `searchIndex.ts`'s prefix guard makes that particular query cheap, but no query can be promised
 * fast as a library grows; here a slow search only makes its results late.
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
    // Search never makes the sidebar fail: the caller turns this into an empty result.
    reply({ id: req.id, error: errorMessage(error) })
  }
})
