import { createReadStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import type { TranscriptBlock, TranscriptMessage, TranscriptPage } from '@shared/types'

const DEFAULT_LIMIT = 200

/**
 * A line longer than this is skipped rather than `JSON.parse`d (SEC-12): a multi-hundred-MB line
 * (a base64 blob, a pasted log, hostile or otherwise) would otherwise be parsed synchronously on
 * the main thread on every page that includes it, which is a real, measurable freeze — the same
 * reasoning as the search indexer's own per-line cap (`search/indexer.ts`).
 */
const MAX_LINE_CHARS = 1_000_000

/** Coerces a JSONL field of unknown shape to a string without ever falling through to
 *  `Object.prototype.toString` — real transcripts only ever put strings and numbers in these
 *  fields, but a malformed line should degrade to `fallback`, not '[object Object]'. */
function asString(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

interface Index {
  offsets: number[]
  messageCount: number
  mtimeMs: number
  size: number
  /** Whether the last line scanned ended with `\n`. Only true, the fast path below can trust that
   *  a byte appended after `size` starts a *new* line at exactly `size` — otherwise the "new"
   *  bytes are actually the tail of what was already the last line, and a full rescan is needed to
   *  get that line's offset and content right. */
  endsWithNewline: boolean
}

/** How many transcripts' offset arrays are kept at once (MAIN-24). Unbounded before this: one
 *  entry per transcript ever opened, for the life of the process. A user who has opened this many
 *  distinct sessions in one run is rare enough that evicting the least-recently-used one costs a
 *  full rescan next time it is reopened, which is the same amount of work a cold session already
 *  pays. */
const MAX_CACHE_ENTRIES = 50

const cache = new Map<string, Index>()

export function clearTranscriptCache(): void {
  cache.clear()
}

/** Records `entry` as the most recently used, evicting the least recently used past the cap. A
 *  `Map` already iterates in insertion order, so "oldest" is just its first key — re-inserting on
 *  every touch (hit or write) is what keeps that order meaning "least recently used" rather than
 *  "first ever inserted". */
function remember(filePath: string, entry: Index): void {
  cache.delete(filePath)
  cache.set(filePath, entry)
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

/**
 * Records the byte offset of every non-empty line from `startByte` onward, and counts message
 * lines by substring test. No JSON parsing, so this stays cheap on multi-megabyte files.
 *
 * `startLineStart` is normally equal to `startByte` (a fresh scan starts counting from byte 0, an
 * appended-bytes scan starts counting from the byte the previous scan ended at) — kept as a
 * separate parameter only so the arithmetic below reads the same regardless of which caller it is.
 */
async function scanFrom(
  filePath: string,
  startByte: number,
  startLineStart: number,
): Promise<{ offsets: number[]; messageCount: number; endsWithNewline: boolean }> {
  const offsets: number[] = []
  let messageCount = 0
  let position = startLineStart
  let lineStart = startLineStart
  let pending = ''
  // The true byte length buffered for the current (still unterminated) line, tracked separately
  // from `pending`'s own length: `pending` is capped at `MAX_LINE_CHARS` below (SEC-12), but the
  // byte offsets recorded for every *later* line still have to be exact, so this keeps counting
  // even once `pending` itself stops growing.
  let pendingBytes = 0
  let endsWithNewline = true

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath, { encoding: 'utf8', start: startByte })
    stream.on('data', (chunk: string | Buffer) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      let from = 0
      for (;;) {
        const nl = text.indexOf('\n', from)
        const segment = text.slice(from, nl === -1 ? undefined : nl)
        pendingBytes += Buffer.byteLength(segment, 'utf8')
        if (pending.length < MAX_LINE_CHARS) pending += segment.slice(0, MAX_LINE_CHARS - pending.length)
        if (nl === -1) break

        const line = pending
        pending = ''
        if (line.length > 0) {
          offsets.push(lineStart)
          if (line.includes('"type":"user"') || line.includes('"type":"assistant"')) messageCount++
        }
        position = lineStart + pendingBytes + 1
        lineStart = position
        pendingBytes = 0
        from = nl + 1
      }
      // Account for the bytes buffered in `pending` on the next iteration.
      position = lineStart + pendingBytes
    })
    stream.on('end', () => {
      if (pending.length > 0) {
        offsets.push(lineStart)
        if (pending.includes('"type":"user"') || pending.includes('"type":"assistant"')) messageCount++
        endsWithNewline = false
      }
      resolve()
    })
    stream.on('error', reject)
  })

  return { offsets, messageCount, endsWithNewline }
}

/**
 * Records the byte offset of every non-empty line and counts message lines by substring test.
 *
 * **Append-only fast path (MAIN-24):** a live session's transcript is only ever appended to, so
 * when the cached size grew and the cached scan ended cleanly on a newline, only the new bytes are
 * read — the old offsets are still correct and are kept as-is. A file that shrank (or whose last
 * cached line had no trailing newline yet) falls back to a full rescan, since neither case can be
 * trusted to mean "unchanged content plus an append".
 */
export async function indexTranscript(
  filePath: string,
): Promise<{ offsets: number[]; messageCount: number }> {
  const info = await stat(filePath)
  const hit = cache.get(filePath)
  if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) {
    remember(filePath, hit)
    return { offsets: hit.offsets, messageCount: hit.messageCount }
  }

  let offsets: number[]
  let messageCount: number
  let endsWithNewline: boolean

  if (hit && hit.endsWithNewline && info.size > hit.size) {
    const delta = await scanFrom(filePath, hit.size, hit.size)
    offsets = hit.offsets.concat(delta.offsets)
    messageCount = hit.messageCount + delta.messageCount
    endsWithNewline = delta.endsWithNewline
  } else {
    const full = await scanFrom(filePath, 0, 0)
    offsets = full.offsets
    messageCount = full.messageCount
    endsWithNewline = full.endsWithNewline
  }

  remember(filePath, { offsets, messageCount, mtimeMs: info.mtimeMs, size: info.size, endsWithNewline })
  return { offsets, messageCount }
}

function mapBlocks(_role: 'user' | 'assistant', content: unknown): TranscriptBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return []

  const blocks: TranscriptBlock[] = []
  for (const raw of content) {
    if (!raw || typeof raw !== 'object') continue
    const b = raw as Record<string, unknown>
    switch (b.type) {
      case 'text':
        if (typeof b.text === 'string') blocks.push({ type: 'text', text: b.text })
        break
      case 'thinking':
        if (typeof b.thinking === 'string') blocks.push({ type: 'thinking', text: b.thinking })
        break
      case 'tool_use':
        blocks.push({
          type: 'tool_use',
          id: asString(b.id, ''),
          name: asString(b.name, 'unknown'),
          input: b.input,
        })
        break
      case 'image': {
        // Claude records a pasted image the way the API carries one: base64 plus its media type.
        // Turning it into a data URL here keeps that shape out of the renderer, which only ever
        // needs something it can put in a src attribute. Anything else (a URL source, a shape from
        // a future version) is skipped rather than guessed at.
        const source = (b as { source?: { type?: string; media_type?: string; data?: string } }).source
        if (source?.type === 'base64' && typeof source.data === 'string' && source.data !== '') {
          const mediaType = typeof source.media_type === 'string' ? source.media_type : 'image/png'
          blocks.push({ type: 'image', dataUrl: `data:${mediaType};base64,${source.data}` })
        }
        break
      }
      case 'tool_result':
        blocks.push({
          type: 'tool_result',
          toolUseId: asString(b.tool_use_id, ''),
          content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
          isError: b.is_error === true,
        })
        break
      default:
        break
    }
  }
  return blocks
}

function toMessage(entry: Record<string, unknown>): TranscriptMessage | null {
  const role = entry.type
  if (role !== 'user' && role !== 'assistant') return null
  const message = entry.message as { content?: unknown } | undefined
  if (!message) return null
  const ts = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN
  return {
    uuid: asString(entry.uuid, ''),
    role,
    timestampMs: Number.isNaN(ts) ? null : ts,
    isSidechain: entry.isSidechain === true,
    blocks: mapBlocks(role, message.content),
  }
}

async function readRange(filePath: string, start: number, end: number): Promise<string> {
  const handle = await open(filePath, 'r')
  try {
    const length = Math.max(0, end - start)
    if (length === 0) return ''
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, start)
    return buffer.toString('utf8')
  } finally {
    await handle.close()
  }
}

interface IndexedMessage {
  /** Line index into the offsets array (not a byte offset). */
  index: number
  message: TranscriptMessage
}

/**
 * Backward paging over the offset index.
 *
 * Widens the scan window [nextStart, end) geometrically until it holds more
 * messages than `limit` (so we know there is a real earlier boundary to
 * report) or reaches line index 0 (the true start of the file, so there is
 * nothing earlier left to report). Each widened window is re-parsed from
 * scratch — cheap relative to the I/O, and simple to reason about.
 *
 * `earlierCursor` is derived from the line index of the earliest message
 * kept on the page, never from the scan's window boundary: the window can
 * extend further back than is needed to fill the page (it doubles each
 * retry), and it can also contain non-message lines, so window-relative
 * arithmetic does not line up with real message positions in general.
 */
export async function readTranscriptPage(
  filePath: string,
  opts: { beforeIndex?: number; limit?: number } = {},
): Promise<TranscriptPage> {
  const limit = opts.limit ?? DEFAULT_LIMIT
  const { offsets } = await indexTranscript(filePath)
  const info = await stat(filePath)
  // A renderer-supplied cursor that is not a real, non-negative index (NaN, most concretely) must
  // not reach the arithmetic below: `Math.min(NaN, n)` is `NaN`, which makes `windowStart === 0`
  // never hold and the loop below spin forever, opening and closing the file on every pass (SEC-8).
  // Anything not a safe non-negative integer is treated as "no cursor", the same as omitting it.
  const beforeIndex = Number.isSafeInteger(opts.beforeIndex) && (opts.beforeIndex as number) >= 0
    ? opts.beforeIndex
    : undefined
  const end = Math.max(0, Math.min(beforeIndex ?? offsets.length, offsets.length))
  if (!Number.isFinite(end)) throw new Error('Could not resolve a valid transcript window')

  // Assigned unconditionally on every iteration before the loop's only `break`, so these are
  // definitely assigned by the time they're read below without needing a throwaway initial value.
  let windowMessages: IndexedMessage[]
  let skippedLines: number
  let windowStart: number
  let span = Math.max(limit * 2, 1)

  for (;;) {
    const nextStart = Math.max(0, end - span)
    const byteStart = nextStart < offsets.length ? offsets[nextStart] : info.size
    const byteEnd = end < offsets.length ? offsets[end] : info.size
    const text = await readRange(filePath, byteStart, byteEnd)

    windowMessages = []
    skippedLines = 0
    let lineIndex = nextStart
    for (const line of text.split('\n')) {
      if (line.length === 0) continue
      if (line.length > MAX_LINE_CHARS) {
        skippedLines++
        lineIndex++
        continue
      }
      let entry: Record<string, unknown>
      try {
        entry = JSON.parse(line) as Record<string, unknown>
      } catch {
        skippedLines++
        lineIndex++
        continue
      }
      const m = toMessage(entry)
      if (m) windowMessages.push({ index: lineIndex, message: m })
      lineIndex++
    }

    windowStart = nextStart
    // Strictly more than `limit`, not >=: landing exactly on `limit` while
    // windowStart is still > 0 would leave us unable to tell whether earlier
    // messages exist, so keep widening until that ambiguity is resolved.
    if (windowMessages.length > limit || windowStart === 0) break
    span *= 2
  }

  const overflow = Math.max(0, windowMessages.length - limit)
  const page = windowMessages.slice(overflow)
  const earlierCursor = overflow > 0 ? page[0].index : null

  return {
    messages: page.map((p) => p.message),
    earlierCursor,
    skippedLines,
  }
}
