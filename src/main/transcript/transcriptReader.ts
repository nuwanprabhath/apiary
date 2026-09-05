import { createReadStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import type { TranscriptBlock, TranscriptMessage, TranscriptPage } from '@shared/types'

const DEFAULT_LIMIT = 200

interface Index { offsets: number[]; messageCount: number; mtimeMs: number; size: number }

const cache = new Map<string, Index>()

export function clearTranscriptCache(): void {
  cache.clear()
}

/**
 * Records the byte offset of every non-empty line and counts message lines by
 * substring test. No JSON parsing, so this stays cheap on multi-megabyte files.
 */
export async function indexTranscript(
  filePath: string,
): Promise<{ offsets: number[]; messageCount: number }> {
  const info = await stat(filePath)
  const hit = cache.get(filePath)
  if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) {
    return { offsets: hit.offsets, messageCount: hit.messageCount }
  }

  const offsets: number[] = []
  let messageCount = 0
  let position = 0
  let lineStart = 0
  let pending = ''

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath, { encoding: 'utf8' })
    stream.on('data', (chunk: string | Buffer) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      let from = 0
      for (;;) {
        const nl = text.indexOf('\n', from)
        if (nl === -1) {
          pending += text.slice(from)
          break
        }
        const line = pending + text.slice(from, nl)
        pending = ''
        if (line.length > 0) {
          offsets.push(lineStart)
          if (line.includes('"type":"user"') || line.includes('"type":"assistant"')) messageCount++
        }
        const consumed = Buffer.byteLength(text.slice(from, nl), 'utf8') + 1
        position += consumed
        lineStart = position
        from = nl + 1
      }
      // Account for the bytes buffered in `pending` on the next iteration.
      position = lineStart + Buffer.byteLength(pending, 'utf8')
    })
    stream.on('end', () => {
      if (pending.length > 0) {
        offsets.push(lineStart)
        if (pending.includes('"type":"user"') || pending.includes('"type":"assistant"')) messageCount++
      }
      resolve()
    })
    stream.on('error', reject)
  })

  cache.set(filePath, { offsets, messageCount, mtimeMs: info.mtimeMs, size: info.size })
  return { offsets, messageCount }
}

function mapBlocks(role: 'user' | 'assistant', content: unknown): TranscriptBlock[] {
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
          id: String(b.id ?? ''),
          name: String(b.name ?? 'unknown'),
          input: b.input,
        })
        break
      case 'tool_result':
        blocks.push({
          type: 'tool_result',
          toolUseId: String(b.tool_use_id ?? ''),
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
    uuid: String(entry.uuid ?? ''),
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
  const end = Math.max(0, Math.min(opts.beforeIndex ?? offsets.length, offsets.length))

  let windowMessages: IndexedMessage[] = []
  let skippedLines = 0
  let windowStart = end
  let span = Math.max(limit * 2, 1)

  for (;;) {
    const nextStart = Math.max(0, end - span)
    const byteStart = nextStart < offsets.length ? offsets[nextStart]! : info.size
    const byteEnd = end < offsets.length ? offsets[end]! : info.size
    const text = await readRange(filePath, byteStart, byteEnd)

    windowMessages = []
    skippedLines = 0
    let lineIndex = nextStart
    for (const line of text.split('\n')) {
      if (line.length === 0) continue
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
  const earlierCursor = overflow > 0 ? page[0]!.index : null

  return {
    messages: page.map((p) => p.message),
    earlierCursor,
    skippedLines,
  }
}
