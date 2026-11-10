import { isFiniteNumber, isRecord } from '@shared/guards'

/**
 * The one decoder for a line of a Claude Code session JSONL. The format is not a published
 * interface, so every field is checked here and a field of the wrong type reads as `undefined`;
 * consumers map the typed entry to their own output and never cast.
 */

export type ContentBlock =
  | { type: 'text'; text: string | undefined }
  | { type: 'thinking'; thinking: string | undefined }
  | { type: 'tool_use'; id: string | undefined; name: string | undefined; input: unknown }
  | { type: 'image'; source: ImageSource | undefined }
  | { type: 'tool_result'; toolUseId: string | undefined; content: unknown; isError: boolean }
  | { type: 'other' }

export interface ImageSource { type: string | undefined; mediaType: string | undefined; data: string | undefined }

/** A message's `content`: a plain string, or its blocks (a block that is not an object is dropped). */
export type MessageContent = string | ContentBlock[] | undefined

export interface Origin { kind: string | undefined; name: string | undefined; body: string | undefined }

interface Common {
  uuid: string | undefined
  timestamp: string | undefined
  isSidechain: boolean
  cwd: string | undefined
  gitBranch: string | undefined
  /** A top-level `title` (summary entries carry one). */
  title: string | undefined
  /** A top-level `content`: a string on `system` and `queue-operation`, blocks on some others. */
  content: MessageContent
}

export interface Message { content: MessageContent }

export type ClaudeEntry = Common & (
  | {
    type: 'user'
    message: Message | undefined
    origin: Origin | undefined
    isMeta: boolean
    sourceToolUseID: string | undefined
  }
  | { type: 'assistant'; message: Message | undefined }
  | {
    type: 'attachment'
    attachment: { type: string | undefined; prompt: MessageContent; sourceUuid: string | undefined; origin: Origin | undefined } | undefined
  }
  | { type: 'system'; subtype: string | undefined; durationMs: number | undefined }
  | { type: 'queue-operation'; operation: string | undefined }
  | { type: 'custom-title'; customTitle: string | undefined }
  | { type: 'ai-title'; aiTitle: string | undefined }
  | { type: 'other'; rawType: string | undefined }
)

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

function block(b: Record<string, unknown>): ContentBlock {
  switch (b.type) {
    case 'text': return { type: 'text', text: str(b.text) }
    case 'thinking': return { type: 'thinking', thinking: str(b.thinking) }
    case 'tool_use': return { type: 'tool_use', id: str(b.id), name: str(b.name), input: b.input }
    case 'image': {
      const s = b.source
      return { type: 'image', source: isRecord(s) ? { type: str(s.type), mediaType: str(s.media_type), data: str(s.data) } : undefined }
    }
    case 'tool_result':
      return { type: 'tool_result', toolUseId: str(b.tool_use_id), content: b.content, isError: b.is_error === true }
    default: return { type: 'other' }
  }
}

function content(v: unknown): MessageContent {
  if (typeof v === 'string') return v
  if (!Array.isArray(v)) return undefined
  return v.filter(isRecord).map(block)
}

function origin(v: unknown): Origin | undefined {
  return isRecord(v) ? { kind: str(v.kind), name: str(v.name), body: str(v.body) } : undefined
}

function message(v: unknown): Message | undefined {
  return isRecord(v) ? { content: content(v.content) } : undefined
}

/** An entry already parsed from JSON (stream-json carries the same entries), or null for a non-object. */
export function entryOf(value: unknown): ClaudeEntry | null {
  if (!isRecord(value)) return null
  const e = value
  const common: Common = {
    uuid: str(e.uuid),
    timestamp: str(e.timestamp),
    isSidechain: e.isSidechain === true,
    cwd: str(e.cwd),
    gitBranch: str(e.gitBranch),
    title: str(e.title),
    content: content(e.content),
  }
  switch (e.type) {
    case 'user':
      return {
        ...common, type: 'user', message: message(e.message), origin: origin(e.origin),
        isMeta: e.isMeta === true, sourceToolUseID: str(e.sourceToolUseID),
      }
    case 'assistant': return { ...common, type: 'assistant', message: message(e.message) }
    case 'attachment': {
      const a = e.attachment
      return {
        ...common, type: 'attachment',
        attachment: isRecord(a) ? { type: str(a.type), prompt: content(a.prompt), sourceUuid: str(a.source_uuid), origin: origin(a.origin) } : undefined,
      }
    }
    case 'system': return { ...common, type: 'system', subtype: str(e.subtype), durationMs: isFiniteNumber(e.durationMs) ? e.durationMs : undefined }
    case 'queue-operation': return { ...common, type: 'queue-operation', operation: str(e.operation) }
    case 'custom-title': return { ...common, type: 'custom-title', customTitle: str(e.customTitle) }
    case 'ai-title': return { ...common, type: 'ai-title', aiTitle: str(e.aiTitle) }
    default: return { ...common, type: 'other', rawType: str(e.type) }
  }
}

/** One JSONL line as a typed entry, or null when it is not a JSON object (a truncated last line is normal). */
export function decodeEntry(line: string): ClaudeEntry | null {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  return entryOf(value)
}
