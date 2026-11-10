import { createReadStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import type { TranscriptBlock, TranscriptMessage, TranscriptPage } from '@shared/types'
import { TRANSCRIPT_PAGE_SIZE } from '@shared/types'
import { taskNotificationIds } from '@shared/chatTimeline'
import type { TranscriptFindResult } from '@shared/ipc/contract'
import { forEachLine, MAX_LINE_CHARS, readExact } from './jsonlLines'
import { decodeEntry, entryOf, type ClaudeEntry, type MessageContent, type Origin } from './claudeEntry'

/** A line longer than this is skipped by its length alone (4 bytes covers any character in `MAX_LINE_CHARS`). */
const SKIP_LINE_BYTES = MAX_LINE_CHARS * 4
/** The most one read asks for. */
const MAX_READ_BYTES = 4 * 1024 * 1024
/** The most lines one page reads; past it the page is what is held, with a cursor to the rest. */
const MAX_PAGE_BYTES = 16 * 1024 * 1024

const DEFAULT_LIMIT = TRANSCRIPT_PAGE_SIZE

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

function mapBlocks(content: MessageContent): TranscriptBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (content === undefined) return []

  const blocks: TranscriptBlock[] = []
  for (const b of content) {
    switch (b.type) {
      case 'text':
        if (b.text !== undefined) blocks.push({ type: 'text', text: b.text })
        break
      case 'thinking':
        if (b.thinking !== undefined) blocks.push({ type: 'thinking', text: b.thinking })
        break
      case 'tool_use':
        blocks.push({ type: 'tool_use', id: b.id ?? '', name: b.name ?? 'unknown', input: b.input })
        break
      case 'image': {
        // Claude records a pasted image as base64 plus media type; a data URL keeps that shape out of
        // the renderer. Any other source shape is skipped.
        const source = b.source
        if (source?.type === 'base64' && source.data !== undefined && source.data !== '') {
          blocks.push({ type: 'image', dataUrl: `data:${source.mediaType ?? 'image/png'};base64,${source.data}` })
        }
        break
      }
      case 'tool_result':
        blocks.push({
          type: 'tool_result',
          toolUseId: b.toolUseId ?? '',
          content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
          isError: b.isError,
        })
        break
      case 'other':
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
  const decoded = entryOf(entry)
  return decoded === null ? null : entryMessage(decoded)
}

/** A decoded entry as a transcript message, or null for anything the transcript does not show. */
export function entryMessage(entry: ClaudeEntry): TranscriptMessage | null {
  const ts = entry.timestamp === undefined ? NaN : Date.parse(entry.timestamp)
  const base = { uuid: entry.uuid ?? '', timestampMs: Number.isNaN(ts) ? null : ts, isSidechain: entry.isSidechain }
  switch (entry.type) {
    case 'attachment': return queuedMessage(entry.attachment, base)
    case 'system': return systemEvent(entry.subtype, entry.durationMs, entry.content, base)
    case 'queue-operation': return queuedTaskEnd(entry.operation, entry.content, base)
    case 'assistant':
      if (!entry.message) return null
      return { ...base, role: 'assistant', blocks: mapBlocks(entry.message.content) }
    case 'user': {
      if (!entry.message) return null
      const blocks = mapBlocks(entry.message.content)
      const folded = peerMessage(entry.origin, blocks) ?? loadedContext(entry.isMeta, entry.sourceToolUseID, blocks)
      return { ...base, role: 'user', blocks: folded === null ? blocks : [folded] }
    }
    case 'custom-title':
    case 'ai-title':
    case 'other':
      return null
  }
}

/** How a skill's instructions begin when Claude Code loads them (measured on 2.1.302). */
const SKILL_BASE = /^Base directory for this skill: (\S+)/

/**
 * Text Claude Code put in the conversation for a tool, not from you: a `user` entry with `isMeta`
 * and the `sourceToolUseID` of the call that loaded it, a skill's instructions above all (pages of
 * them, which the chat drew as if you had written them).
 */
function loadedContext(isMeta: boolean, sourceToolUseID: string | undefined, blocks: TranscriptBlock[]): TranscriptBlock | null {
  if (!isMeta || sourceToolUseID === undefined) return null
  const text = blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
  if (text.trim() === '') return null
  const dir = SKILL_BASE.exec(text)?.[1] ?? null
  return { type: 'loaded_context', name: dir === null ? null : dir.replace(/\/+$/, '').split('/').pop() ?? null, text }
}

/** The preamble Claude Code puts before a subagent's report ("[Subagent hand-back] The text below is
 *  the final report … The report follows:"), addressed to Claude, not to you. */
const HANDBACK_FRAME = /^\s*\[Subagent hand-back\][\s\S]*?The report follows:\s*/

function withoutHandbackFrame(body: string): string {
  const report = body.replace(HANDBACK_FRAME, '')
  return report.trim() === '' ? body : report
}

/**
 * Another Claude session's message (a subagent reporting back), which Claude Code writes as a
 * `user` entry with `origin: { kind: 'peer', name, body }` (measured on 2.1.302). `body` is the
 * sender's own words, without the framing around them in the entry's text.
 */
function peerMessage(origin: Origin | undefined, blocks: TranscriptBlock[]): TranscriptBlock | null {
  if (origin?.kind !== 'peer') return null
  const body = origin.body !== undefined && origin.body.trim() !== '' ? withoutHandbackFrame(origin.body) : null
  const text = body ?? blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
  return { type: 'peer_message', from: origin.name !== undefined && origin.name !== '' ? origin.name : null, text }
}

type MessageBase = Pick<TranscriptMessage, 'uuid' | 'timestampMs' | 'isSidechain'>
type Attachment = Extract<ClaudeEntry, { type: 'attachment' }>['attachment']

/**
 * A message sent while Claude was mid-turn. Claude Code records it not as a `user` entry but as an
 * `attachment` of type `queued_command`, after the tool result it followed. It is filed under its
 * `source_uuid` (the uuid chat mode's stream replays it under) so the live copy and this one merge.
 */
function queuedMessage(a: Attachment, base: MessageBase): TranscriptMessage | null {
  if (a?.type !== 'queued_command') return null
  const blocks = mapBlocks(a.prompt)
  if (blocks.length === 0) return null
  // A subagent's report that arrived mid-turn is queued like this, its peer origin inside.
  const peer = peerMessage(a.origin, blocks)
  return { ...base, uuid: a.sourceUuid ?? base.uuid, role: 'user', blocks: peer === null ? blocks : [peer] }
}

/**
 * A background task's notification that Claude Code queued (`queue-operation` `enqueue`). It is
 * often never delivered as a message (the session moved on or ended first), and without it the
 * task looked as if it ran forever, keeping its tab "working" (measured on 2.1.302).
 */
function queuedTaskEnd(operation: string | undefined, content: MessageContent, base: MessageBase): TranscriptMessage | null {
  if (operation !== 'enqueue' || typeof content !== 'string' || !content.includes('<task-notification>')) return null
  const taskIds = taskNotificationIds(content)
  if (taskIds.length === 0) return null
  return { ...base, role: 'assistant', blocks: [{ type: 'task_ended', taskIds }] }
}

/** The two `system` entries the chat view shows: a turn's duration and a recap. */
function systemEvent(
  subtype: string | undefined, durationMs: number | undefined, content: MessageContent, base: MessageBase,
): TranscriptMessage | null {
  if (subtype === 'turn_duration' && durationMs !== undefined) {
    return { ...base, role: 'assistant', blocks: [{ type: 'turn_end', durationMs }] }
  }
  if (subtype === 'away_summary' && typeof content === 'string' && content.trim() !== '') {
    return { ...base, role: 'assistant', blocks: [{ type: 'recap', text: content }] }
  }
  return null
}

interface IndexedMessage {
  /** Line index into the offsets array (not a byte offset). */
  index: number
  message: TranscriptMessage
}

/** The messages in a run of whole lines, each with its line index (`firstIndex` is the first line's). */
function parseMessageLines(text: string, firstIndex: number): { messages: IndexedMessage[]; skippedLines: number } {
  const messages: IndexedMessage[] = []
  let skippedLines = 0
  let lineIndex = firstIndex
  for (const line of text.split('\n')) {
    if (line.length === 0) continue
    if (line.length > MAX_LINE_CHARS) {
      skippedLines++
      lineIndex++
      continue
    }
    const entry = decodeEntry(line)
    if (entry === null) {
      skippedLines++
      lineIndex++
      continue
    }
    const m = entryMessage(entry)
    if (m) messages.push({ index: lineIndex, message: m })
    lineIndex++
  }
  return { messages, skippedLines }
}

interface Collected {
  /** At most `limit`, oldest first. */
  messages: IndexedMessage[]
  earlierCursor: number | null
  skippedLines: number
}

/**
 * Walks lines `end - 1` down to `floor`, newest first: a line over `SKIP_LINE_BYTES` is skipped by
 * its length without being read, runs of other lines are read in pieces of at most `MAX_READ_BYTES`.
 * Stops with more than `limit` messages, at `floor`, or after `MAX_PAGE_BYTES` of lines.
 * `earlierCursor` is the earliest kept message's line index when anything earlier is left unread
 * or was cut off by `limit`.
 */
async function collectBackward(
  filePath: string,
  offsets: number[],
  size: number,
  end: number,
  floor: number,
  limit: number,
): Promise<Collected> {
  const offsetAt = (i: number): number => offsets[i] ?? size
  const lineEnd = (i: number): number => (i + 1 < offsets.length ? offsetAt(i + 1) : size)
  let held: IndexedMessage[] = []
  let skippedLines = 0, readBytes = 0
  let next = end - 1
  let handle: FileHandle | null = null
  try {
    while (next >= floor && held.length <= limit && readBytes < MAX_PAGE_BYTES) {
      if (lineEnd(next) - offsetAt(next) > SKIP_LINE_BYTES) {
        skippedLines++
        next--
        continue
      }
      const room = Math.min(MAX_READ_BYTES, MAX_PAGE_BYTES - readBytes)
      let bytes = lineEnd(next) - offsetAt(next)
      if (bytes > room) break
      const runEnd = next
      let runStart = next
      while (runStart - 1 >= floor) {
        const len = lineEnd(runStart - 1) - offsetAt(runStart - 1)
        if (len > SKIP_LINE_BYTES || bytes + len > room) break
        bytes += len
        runStart--
      }
      handle ??= await open(filePath, 'r')
      const length = lineEnd(runEnd) - offsetAt(runStart)
      const buffer = Buffer.alloc(length)
      const got = await readExact(handle, buffer, offsetAt(runStart))
      const parsed = parseMessageLines(buffer.toString('utf8', 0, got), runStart)
      held = parsed.messages.concat(held)
      skippedLines += parsed.skippedLines
      readBytes += length
      next = runStart - 1
    }
  } finally {
    await handle?.close()
  }
  const overflow = Math.max(0, held.length - limit)
  const page = held.slice(overflow)
  const unread = next >= floor
  const earlierCursor = overflow > 0 || (unread && page.length > 0) ? (page[0]?.index ?? null) : unread ? next + 1 : null
  return { messages: page, earlierCursor, skippedLines }
}

/** The most hits one find call answers, and roughly the most time it works before answering with a cursor. */
const FIND_HITS = 50
const FIND_BUDGET_MS = 200

/** What find looks in: the text the transcript shows (text, thinking, tool names), never the raw JSON. */
function shownText(m: TranscriptMessage): string {
  return m.blocks.map((b) => ('text' in b ? b.text : b.type === 'tool_use' ? b.name : '')).join('\n')
}

function lineMessage(line: string): TranscriptMessage | null {
  // A line that is not JSON is no message, here as in a page (where `skippedLines` counts it).
  const entry = decodeEntry(line)
  return entry === null ? null : entryMessage(entry)
}

/** Lines `first` onwards, oldest first, until `limit` messages, the end, or `MAX_PAGE_BYTES` of lines. */
async function collectForward(
  filePath: string, offsets: number[], size: number, first: number, limit: number,
): Promise<Collected> {
  const offsetAt = (i: number): number => offsets[i] ?? size
  const lineEnd = (i: number): number => (i + 1 < offsets.length ? offsetAt(i + 1) : size)
  const held: IndexedMessage[] = []
  let skippedLines = 0, readBytes = 0
  let next = first
  let handle: FileHandle | null = null
  try {
    while (next < offsets.length && held.length < limit && readBytes < MAX_PAGE_BYTES) {
      if (lineEnd(next) - offsetAt(next) > SKIP_LINE_BYTES) { skippedLines++; next++; continue }
      let runEnd = next + 1
      while (runEnd < offsets.length && lineEnd(runEnd) - offsetAt(runEnd) <= SKIP_LINE_BYTES
        && lineEnd(runEnd) - offsetAt(next) <= MAX_READ_BYTES) runEnd++
      handle ??= await open(filePath, 'r')
      const length = lineEnd(runEnd - 1) - offsetAt(next)
      const buffer = Buffer.alloc(length)
      const parsed = parseMessageLines(buffer.toString('utf8', 0, await readExact(handle, buffer, offsetAt(next))), next)
      held.push(...parsed.messages)
      skippedLines += parsed.skippedLines
      readBytes += length
      next = runEnd
    }
  } finally {
    await handle?.close()
  }
  return { messages: held.slice(0, limit), earlierCursor: null, skippedLines }
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
  ): Promise<{ offsets: number[]; messageCount: number; size: number }> {
    const info = await stat(filePath)
    const hit = this.cache.get(filePath)
    if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) {
      this.remember(filePath, hit)
      return { offsets: hit.offsets, messageCount: hit.messageCount, size: hit.size }
    }

    let offsets: number[]
    let messageCount: number
    let endsWithNewline: boolean

    if (hit && hit.endsWithNewline && info.size > hit.size) {
      const delta = await scanFrom(filePath, hit.size, hit.size)
      offsets = hit.offsets
      for (const o of delta.offsets) offsets.push(o)
      messageCount = hit.messageCount + delta.messageCount
      endsWithNewline = delta.endsWithNewline
    } else {
      const full = await scanFrom(filePath, 0, 0)
      offsets = full.offsets
      messageCount = full.messageCount
      endsWithNewline = full.endsWithNewline
    }

    this.remember(filePath, { offsets, messageCount, mtimeMs: info.mtimeMs, size: info.size, endsWithNewline })
    return { offsets, messageCount, size: info.size }
  }

  /**
   * Backward paging over the offset index.
   *
   * Reads lines from `end - 1` backwards (`collectBackward`) until it holds more messages than
   * `limit` (so a real earlier boundary exists), reaches line 0, or has read 16 MB.
   *
   * `earlierCursor` comes from the line index of the earliest message kept on the page.
   */
  async readTranscriptPage(
    filePath: string,
    opts: { beforeIndex?: number; limit?: number } = {},
  ): Promise<TranscriptPage> {
    const limit = opts.limit ?? DEFAULT_LIMIT
    const { offsets, size } = await this.indexTranscript(filePath)
    const count = offsets.length
    // A renderer-supplied NaN cursor must not reach the walk; anything not a safe non-negative
    // integer counts as "no cursor".
    const beforeIndex = Number.isSafeInteger(opts.beforeIndex) && (opts.beforeIndex as number) >= 0
      ? opts.beforeIndex
      : undefined
    const end = Math.max(0, Math.min(beforeIndex ?? count, count))
    const page = await collectBackward(filePath, offsets, size, end, 0, limit)
    return {
      messages: page.messages.map((p) => ({ ...p.message, index: p.index })),
      earlierCursor: page.earlierCursor,
      skippedLines: page.skippedLines,
    }
  }

  /**
   * The messages on lines after `afterIndex`, for a transcript that already holds everything up to
   * it. More than a page of them (a burst) answers the newest page with `earlierCursor` set, which
   * the caller appends without an overlap, as the full-page refresh does. With `limit`, the next
   * page after `afterIndex` instead, for a view reading forward through history.
   */
  async readTranscriptAfter(filePath: string, afterIndex: number, limit = false): Promise<TranscriptPage> {
    const { offsets, size } = await this.indexTranscript(filePath)
    const count = offsets.length
    const first = Number.isSafeInteger(afterIndex) && afterIndex >= 0 ? afterIndex + 1 : 0
    if (first >= count) return { messages: [], earlierCursor: null, skippedLines: 0 }
    const page = limit
      ? await collectForward(filePath, offsets, size, first, DEFAULT_LIMIT)
      : await collectBackward(filePath, offsets, size, count, first, DEFAULT_LIMIT)
    return {
      messages: page.messages.map((p) => ({ ...p.message, index: p.index })),
      earlierCursor: page.earlierCursor,
      skippedLines: page.skippedLines,
    }
  }

  /**
   * Up to `FIND_HITS` line indexes of messages whose shown text contains `query` (any case), newest
   * first, from the line before `before` backwards. Reads at most `MAX_READ_BYTES` per step and
   * yields between steps; past `FIND_BUDGET_MS` it answers what it has. `cursor` is the `before` of
   * the next call, null once line 0 is reached.
   */
  async findInTranscript(filePath: string, query: string, before: number | null): Promise<TranscriptFindResult> {
    const needle = query.toLowerCase()
    const indexes: number[] = []
    if (needle === '') return { indexes, cursor: null }
    const { offsets, size } = await this.indexTranscript(filePath)
    const offsetAt = (i: number): number => offsets[i] ?? size
    const lineEnd = (i: number): number => (i + 1 < offsets.length ? offsetAt(i + 1) : size)
    const lineBytes = (i: number): number => lineEnd(i) - offsetAt(i)
    const valid = before !== null && Number.isSafeInteger(before) && before >= 0
    const started = Date.now()
    let next = (valid ? Math.min(before, offsets.length) : offsets.length) - 1
    while (next >= 0) {
      if (lineBytes(next) > SKIP_LINE_BYTES) { next--; continue }
      let runStart = next
      let bytes = lineBytes(next)
      while (runStart > 0 && lineBytes(runStart - 1) <= SKIP_LINE_BYTES && bytes + lineBytes(runStart - 1) <= MAX_READ_BYTES) bytes += lineBytes(--runStart)
      const lines: string[] = []
      await forEachLine(filePath, { start: offsetAt(runStart), end: lineEnd(next), maxLineBytes: SKIP_LINE_BYTES }, (l) => { lines.push(l) })
      for (let k = lines.length - 1; k >= 0; k--) {
        const m = lineMessage(lines[k] ?? '')
        if (m === null || !shownText(m).toLowerCase().includes(needle)) continue
        indexes.push(runStart + k)
        if (indexes.length === FIND_HITS) return { indexes, cursor: runStart + k }
      }
      next = runStart - 1
      if (next >= 0 && Date.now() - started > FIND_BUDGET_MS) return { indexes, cursor: next + 1 }
      await new Promise<void>((resolve) => { setImmediate(resolve) })
    }
    return { indexes, cursor: null }
  }
}
