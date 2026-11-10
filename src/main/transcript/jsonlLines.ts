import { open } from 'node:fs/promises'

/**
 * A line longer than this is skipped rather than `JSON.parse`d: a multi-hundred-MB line (a base64
 * blob, a pasted log) would freeze the main thread on every page that includes it. The search
 * indexer has the same cap (`search/indexer.ts`).
 */
export const MAX_LINE_CHARS = 1_000_000

const NEWLINE = 0x0a
export const DEFAULT_CHUNK_BYTES = 65536

/** The one `FileHandle.read` form `readExact` calls, so a test can hand it a reader that returns short. */
interface Readable {
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>
}

/**
 * Fills `buffer` from `position`, continuing after a short read (a network file system may return
 * fewer bytes than asked). Returns the bytes read, less than the buffer's length only at end of file.
 */
export async function readExact(handle: Readable, buffer: Buffer, position: number): Promise<number> {
  let filled = 0
  while (filled < buffer.length) {
    const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, position + filled)
    if (bytesRead === 0) break
    filled += bytesRead
  }
  return filled
}

export interface LineRange {
  start: number
  /** Exclusive; the file's size when absent. */
  end?: number
  /** A longer line is skipped and counted, never held in memory whole. */
  maxLineBytes: number
  chunkBytes?: number
}

export interface LineResult {
  /** The byte offset just past the last whole line; a partial last line starts here. */
  nextOffset: number
  skipped: number
}

/** Visits each non-empty whole line in `[start, end)`, decoded as UTF-8 one line at a time. */
export async function forEachLine(
  filePath: string,
  range: LineRange,
  visit: (line: string) => void,
): Promise<LineResult> {
  const handle = await open(filePath, 'r')
  try {
    const end = range.end ?? (await handle.stat()).size
    const buffer = Buffer.alloc(range.chunkBytes ?? DEFAULT_CHUNK_BYTES)
    let position = range.start
    let lineStart = range.start
    let lineBytes = 0
    let parts: Buffer[] = []
    let skipped = 0
    while (position < end) {
      const want = Math.min(buffer.length, end - position)
      const read = await readExact(handle, buffer.subarray(0, want), position)
      if (read === 0) break
      const chunk = buffer.subarray(0, read)
      let from = 0
      for (;;) {
        const nl = chunk.indexOf(NEWLINE, from)
        const stop = nl === -1 ? chunk.length : nl
        lineBytes += stop - from
        if (lineBytes <= range.maxLineBytes) parts.push(Buffer.from(chunk.subarray(from, stop)))
        else parts = []
        if (nl === -1) break
        if (lineBytes > range.maxLineBytes) skipped++
        else if (lineBytes > 0) visit(Buffer.concat(parts).toString('utf8'))
        lineStart = position + nl + 1
        lineBytes = 0
        parts = []
        from = nl + 1
      }
      position += read
    }
    return { nextOffset: lineStart, skipped }
  } finally {
    await handle.close()
  }
}
