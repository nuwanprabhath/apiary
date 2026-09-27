import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { extractLineText } from './extractText'
import { MAX_TEXT_PER_SESSION, type SearchIndex } from './searchIndex'

/** A line longer than this is skipped before it is even parsed (SEC-12): a multi-hundred-MB line
 *  (a base64 blob, a pasted log) would otherwise be `JSON.parse`d synchronously on the main thread
 *  regardless of whether any of it ends up indexed — indexing runs there by design (see the file
 *  comment), so a pathological line is a real, measurable freeze, not just wasted work. */
const MAX_LINE_LENGTH = 1_000_000

/**
 * Keeps the search index up to date without the app noticing.
 *
 * **Why this is not a worker thread.** The renderer is already its own process, so indexing can
 * never freeze what is on screen; the only thing at stake is how quickly the main process answers
 * IPC. That makes the cost of a worker — a second bundled entry point, a second database
 * connection, and a message protocol — buy very little over simply yielding often enough, which is
 * what this does: one file at a time, yielding to the event loop between each, so no single pass
 * holds the loop for longer than one file takes to read. If a session file ever gets large enough
 * that reading one is itself too long a pause, the fix is to yield inside the read (the line reader
 * below already streams rather than slurping), not to move the whole thing off-thread.
 *
 * Work is incremental: a session whose file has not changed since it was last indexed is skipped
 * without being opened, so the steady-state cost after the first pass is close to nothing.
 */

export interface IndexableSession {
  sessionId: string
  /** Absolute path to the session's JSONL. */
  file: string
}

export interface IndexRunResult {
  /** Sessions actually read and indexed this pass. */
  indexed: number
  /** Sessions skipped because their file had not changed. */
  skipped: number
}

/**
 * Reads one session's JSONL and returns the text worth indexing from it.
 *
 * Stops collecting once the running length passes `MAX_TEXT_PER_SESSION` (SEC-12) rather than
 * joining everything first and truncating in `searchIndex.ts` afterwards — a session with enough
 * lines could otherwise hold an unbounded array in memory for a result that was going to be cut
 * down to 2MB anyway. A line over `MAX_LINE_LENGTH` is skipped before `extractLineText` ever
 * `JSON.parse`s it.
 */
export async function readSearchText(file: string): Promise<string> {
  const parts: string[] = []
  let length = 0
  const reader = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  try {
    for await (const line of reader) {
      if (length >= MAX_TEXT_PER_SESSION) break
      if (line.length > MAX_LINE_LENGTH) continue
      const text = extractLineText(line)
      if (text !== null) {
        parts.push(text)
        length += text.length + 1 // +1 for the '\n' the eventual join() adds
      }
    }
  } finally {
    reader.close()
  }
  return parts.join('\n')
}

/** Lets the event loop run. Between files, so IPC is never waiting on the whole queue. */
const yieldToLoop = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve) })

/**
 * Brings the index up to date for the given sessions.
 *
 * `shouldStop` is checked between files so a run can be abandoned promptly — on quit, or when the
 * setting is switched off mid-pass — rather than having to finish what it started.
 */
export async function runIndexPass(
  index: SearchIndex,
  sessions: IndexableSession[],
  shouldStop: () => boolean = () => false,
): Promise<IndexRunResult> {
  let indexed = 0
  let skipped = 0

  for (const session of sessions) {
    if (shouldStop()) break
    let size: number
    let mtimeMs: number
    try {
      const info = await stat(session.file)
      size = info.size
      mtimeMs = info.mtimeMs
    } catch {
      // A session whose file has gone is simply dropped from the index rather than reported: the
      // tree will stop listing it too, and a missing file is not a failure worth interrupting for.
      index.forget(session.sessionId)
      continue
    }

    if (!index.needsIndexing(session.sessionId, size, mtimeMs)) {
      skipped += 1
      continue
    }

    try {
      const text = await readSearchText(session.file)
      index.put(session.sessionId, text, size, mtimeMs)
      indexed += 1
    } catch {
      // One unreadable session must not stop the rest of the pass.
    }
    await yieldToLoop()
  }

  return { indexed, skipped }
}
