import { open, stat } from 'node:fs/promises'
import { ignoreErrorsAsync } from '@shared/ignoreErrors'
import { forEachLine, MAX_LINE_CHARS, readExact } from '../transcript/jsonlLines'
import { extractLineText } from './extractText'
import { extractRefs, type Ref } from './refs'
import { yieldToLoop } from '../util/yieldToLoop'
import { CHUNK_CHARS, MAX_TEXT_PER_SESSION, type SearchIndex } from './searchIndex'

/** A longer line (a base64 blob, a pasted log) is skipped unparsed: `JSON.parse` would freeze the main thread. */
export const MAX_LINE_LENGTH = MAX_LINE_CHARS

/** The byte form of `MAX_LINE_LENGTH` for the line reader (up to three bytes a character). */
const INDEX_LINE_BYTE_CAP =MAX_LINE_LENGTH * 3

/**
 * Keeps the search index up to date on the main thread.
 *
 * **Why this is not a worker thread.** The renderer is its own process, so indexing cannot freeze
 * what is on screen; only the main process's IPC latency is at stake, and yielding to the event
 * loop between files covers that without a second entry point, database connection and message
 * protocol. If one file's read ever pauses too long, yield inside the read (the line reader
 * already streams) rather than moving it off-thread.
 *
 * Incremental: a session whose file has not changed is skipped without being opened, and one that
 * only grew is read from where the last pass stopped.
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
 * Reads the text worth indexing from byte `from` on, as chunks of at most `CHUNK_CHARS`.
 *
 * Keeps the newest text within `MAX_TEXT_PER_SESSION` while reading (and the first chunk when
 * `keepFirst`), so a huge session never holds an unbounded array.
 */
async function readSearchChunks(file: string, from: number, keepFirst: boolean): Promise<{
  chunks: string[]
  refs: Ref[]
  upto: number
}> {
  const chunks: string[] = []
  const refs = new Map<string, Ref>()
  let current = ''
  let held = 0
  const push = (chunk: string): void => {
    chunks.push(chunk)
    held += chunk.length
    while (held > MAX_TEXT_PER_SESSION && chunks.length > (keepFirst ? 2 : 1)) {
      const at = keepFirst ? 1 : 0
      held -= chunks[at]?.length ?? 0
      chunks.splice(at, 1)
    }
  }
  const { nextOffset } = await forEachLine(file, { start: from, maxLineBytes: INDEX_LINE_BYTE_CAP }, (line) => {
    if (line.length > MAX_LINE_LENGTH) return
    const text = extractLineText(line)
    if (text === null) return
    for (const ref of extractRefs(text)) refs.set(`${ref.kind}|${ref.value}`, ref)
    current = current === '' ? text : `${current}\n${text}`
    while (current.length >= CHUNK_CHARS) {
      push(current.slice(0, CHUNK_CHARS))
      current = current.slice(CHUNK_CHARS)
    }
  })
  if (current !== '') push(current)
  return { chunks, refs: [...refs.values()], upto: nextOffset }
}

/** The searchable text a whole read of the session keeps: its first chunk and its newest. */
export async function readSearchText(file: string): Promise<string> {
  return (await readSearchChunks(file, 0, true)).chunks.join('\n')
}

/** A file rewritten rather than appended to rarely has a newline just before the old offset. */
async function endsAtLineBoundary(file: string, upto: number): Promise<boolean> {
  if (upto <= 0) return false
  const handle = await open(file, 'r')
  try {
    const byte = Buffer.alloc(1)
    const read = await readExact(handle, byte, upto - 1)
    return read === 1 && byte[0] === 0x0a
  } finally {
    await handle.close()
  }
}

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
      // A file that only grew is read from where the last pass stopped; anything else starts again.
      const state = index.indexState(session.sessionId)
      const reset = state === undefined || size <= state.size || !(await endsAtLineBoundary(session.file, state.upto))
      const from = reset ? 0 : state.upto
      const { chunks, refs, upto } = await readSearchChunks(session.file, from, reset)
      index.write(session.sessionId, { chunks, refs, size, mtimeMs, upto, reset })
      indexed += 1
    }, 'one unreadable session must not stop the rest of the pass')
    await yieldToLoop()
  }

  return { indexed, skipped }
}
