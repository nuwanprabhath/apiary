import { createReadStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import type { TranscriptBlock, TranscriptMessage, TranscriptPage } from '@shared/types'
import { TRANSCRIPT_PAGE_SIZE } from '@shared/types'

const DEFAULT_LIMIT = TRANSCRIPT_PAGE_SIZE

/**
 * A line longer than this is skipped rather than `JSON.parse`d: a multi-hundred-MB line (a base64
 * blob, a pasted log) would freeze the main thread on every page that includes it. The search
 * indexer has the same cap (`search/indexer.ts`).
 */
export const MAX_LINE_CHARS = 1_000_000

/** Coerces a JSONL field of unknown shape to a string; a malformed line gives `fallback`, not '[object Object]'. */
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
  /** Whether the last line scanned ended with `\n`; only then does a byte appended after `size` start a new line. */
  endsWithNewline: boolean
}

/** How many transcripts' offset arrays are kept at once; evicting one costs a full rescan on reopen. */
const MAX_CACHE_ENTRIES = 50

/** Whether a raw line is a message someone wrote — by substring, without parsing. A message sent
 *  mid-turn counts (it is recorded as a `queued_command` attachment); turn ends and recaps, which
 *  `toMessage` also returns, do not: this is the count the session list shows. */
function countsAsMessage(line: string): boolean {
  return line.includes('"type":"user"') || line.includes('"type":"assistant"') || line.includes('"queued_command"')
}

/**
 * Records the byte offset of every non-empty line from `startByte` onward, and counts message
 * lines by substring test. No JSON parsing, so this stays cheap on multi-megabyte files.
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
  // True byte length of the current unterminated line: `pending` stops growing at `MAX_LINE_CHARS`,
  // but later lines' offsets must stay exact.
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
          if (countsAsMessage(line)) messageCount++
        }
        position = lineStart + pendingBytes + 1
        lineStart = position
        pendingBytes = 0
        from = nl + 1
      }
      position = lineStart + pendingBytes
    })
    stream.on('end', () => {
      if (pending.length > 0) {
        offsets.push(lineStart)
        if (countsAsMessage(pending)) messageCount++
        endsWithNewline = false
      }
      resolve()
    })
    stream.on('error', reject)
  })

  return { offsets, messageCount, endsWithNewline }
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
        // Claude records a pasted image as base64 plus media type; a data URL keeps that shape out of
        // the renderer. Any other source shape is skipped.
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

/**
 * One JSONL entry as a transcript message, or null for anything that is not a user or assistant
 * turn. Exported for chat mode (`main/chat/protocol.ts`): `claude`'s stream-json output carries
 * the very same entries, uuid and all, before they reach the file.
 */
export function toMessage(entry: Record<string, unknown>): TranscriptMessage | null {
  const role = entry.type
  const ts = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN
  const base = { uuid: asString(entry.uuid, ''), timestampMs: Number.isNaN(ts) ? null : ts, isSidechain: entry.isSidechain === true }
  if (role === 'attachment') return queuedMessage(entry, base)
  if (role === 'system') return systemEvent(entry, base)
  if (role !== 'user' && role !== 'assistant') return null
  const message = entry.message as { content?: unknown } | undefined
  if (!message) return null
  return { ...base, role, blocks: mapBlocks(role, message.content) }
}

type MessageBase = Pick<TranscriptMessage, 'uuid' | 'timestampMs' | 'isSidechain'>

/**
 * A message sent while Claude was mid-turn. Claude Code records it not as a `user` entry but as an
 * `attachment` of type `queued_command`, after the tool result it followed. It is filed under its
 * `source_uuid` (the uuid chat mode's stream replays it under) so the live copy and this one merge.
 */
function queuedMessage(entry: Record<string, unknown>, base: MessageBase): TranscriptMessage | null {
  const a = entry.attachment as { type?: unknown; prompt?: unknown; source_uuid?: unknown } | undefined
  if (a?.type !== 'queued_command') return null
  const blocks = mapBlocks('user', a.prompt)
  if (blocks.length === 0) return null
  return { ...base, uuid: asString(a.source_uuid, base.uuid), role: 'user', blocks }
}

/** The two `system` entries the chat view shows: a turn's duration and a recap. */
function systemEvent(entry: Record<string, unknown>, base: MessageBase): TranscriptMessage | null {
  if (entry.subtype === 'turn_duration' && typeof entry.durationMs === 'number') {
    return { ...base, role: 'assistant', blocks: [{ type: 'turn_end', durationMs: entry.durationMs }] }
  }
  if (entry.subtype === 'away_summary' && typeof entry.content === 'string' && entry.content.trim() !== '') {
    return { ...base, role: 'assistant', blocks: [{ type: 'recap', text: entry.content }] }
  }
  return null
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

/** Reads a session's JSONL a page at a time, keeping a line-offset index per file (bounded at `MAX_CACHE_ENTRIES`). */
export class TranscriptReader {
  /** Invalidated by the file's size and mtime (checked on every read) and by the LRU cap. */
  private readonly cache = new Map<string, Index>()

  /** Records `entry` as most recently used, evicting past the cap. Re-inserting on every touch keeps `Map` order meaning LRU. */
  private remember(filePath: string, entry: Index): void {
    this.cache.delete(filePath)
    this.cache.set(filePath, entry)
    if (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
  }

  /**
   * Records the byte offset of every non-empty line and counts message lines by substring test.
   *
   * **Append-only fast path:** when the file grew and the cached scan ended on a newline, only the
   * new bytes are read. A file that shrank, or whose last cached line had no trailing newline,
   * gets a full rescan.
   */
  async indexTranscript(
    filePath: string,
  ): Promise<{ offsets: number[]; messageCount: number }> {
    const info = await stat(filePath)
    const hit = this.cache.get(filePath)
    if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) {
      this.remember(filePath, hit)
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

    this.remember(filePath, { offsets, messageCount, mtimeMs: info.mtimeMs, size: info.size, endsWithNewline })
    return { offsets, messageCount }
  }

  /**
   * Backward paging over the offset index.
   *
   * Widens the scan window [nextStart, end) geometrically until it holds more messages than
   * `limit` (so a real earlier boundary exists) or reaches line index 0. Each window is re-parsed
   * from scratch.
   *
   * `earlierCursor` comes from the line index of the earliest message kept on the page, never from
   * the window boundary: the window can reach further back than the page needs and contains
   * non-message lines.
   */
  async readTranscriptPage(
    filePath: string,
    opts: { beforeIndex?: number; limit?: number } = {},
  ): Promise<TranscriptPage> {
    const limit = opts.limit ?? DEFAULT_LIMIT
    const { offsets } = await this.indexTranscript(filePath)
    const info = await stat(filePath)
    // A renderer-supplied NaN cursor would make `windowStart === 0` never hold and spin the loop
    // forever; anything not a safe non-negative integer counts as "no cursor".
    const beforeIndex = Number.isSafeInteger(opts.beforeIndex) && (opts.beforeIndex as number) >= 0
      ? opts.beforeIndex
      : undefined
    const end = Math.max(0, Math.min(beforeIndex ?? offsets.length, offsets.length))
    if (!Number.isFinite(end)) throw new Error('Could not resolve a valid transcript window')

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
      // Strictly more than `limit`: exactly `limit` with windowStart > 0 cannot tell whether earlier messages exist.
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
}
