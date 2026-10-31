import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { ignoreErrorsAsync } from '@shared/ignoreErrors'
import { extractLineText } from './extractText'
import { extractRefs, type Ref } from '../knowledge/refs'
import { MAX_TEXT_PER_SESSION, type SearchIndex } from './searchIndex'

/** A longer line (a base64 blob, a pasted log) is skipped unparsed: `JSON.parse` would freeze the main thread. */
export const MAX_LINE_LENGTH = 1_000_000

/**
 * Keeps the search index up to date on the main thread.
 *
 * **Why this is not a worker thread.** The renderer is its own process, so indexing cannot freeze
 * what is on screen; only the main process's IPC latency is at stake, and yielding to the event
 * loop between files covers that without a second entry point, database connection and message
 * protocol. If one file's read ever pauses too long, yield inside the read (the line reader
 * already streams) rather than moving it off-thread.
 *
 * Incremental: a session whose file has not changed is skipped without being opened.
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
 * Stops collecting once the length passes `MAX_TEXT_PER_SESSION`, so a huge session never holds an
 * unbounded array that `searchIndex.ts` would cut down anyway.
 */
export async function readSearchText(file: string): Promise<string> {
  return (await readSearchData(file)).text
}

/** The searchable text of a session and the refs (MRs, issues, tickets, links) mentioned in it. */
async function readSearchData(file: string): Promise<{ text: string; refs: Ref[] }> {
  const parts: string[] = []
  const refs = new Map<string, Ref>()
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
        for (const ref of extractRefs(text)) refs.set(`${ref.kind}|${ref.value}`, ref)
        length += text.length + 1 // +1 for the '\n' the eventual join() adds
      }
    }
  } finally {
    reader.close()
  }
  return { text: parts.join('\n'), refs: [...refs.values()] }
}

export const yieldToLoop = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve) })

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
      // A vanished file is dropped from the index, not reported.
      index.forget(session.sessionId)
      continue
    }

    if (!index.needsIndexing(session.sessionId, size, mtimeMs)) {
      skipped += 1
      continue
    }

    await ignoreErrorsAsync(async () => {
      const { text, refs } = await readSearchData(session.file)
      index.put(session.sessionId, text, size, mtimeMs, refs)
      indexed += 1
    }, 'one unreadable session must not stop the rest of the pass')
    await yieldToLoop()
  }

  return { indexed, skipped }
}
