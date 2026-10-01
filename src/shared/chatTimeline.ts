import type { TranscriptMessage } from './domain/transcript'

/**
 * The transcript as the chat view draws it — the VS Code extension's shape: your messages as
 * boxes, Claude's prose, "Thought" rows, and each tool call as one row with its input and its
 * output together. In the session file a tool call and its result are two messages (the call in
 * Claude's, the result in the next "user" one); here they are paired by tool-use id, and a user
 * message that only carried results disappears into the calls it answered.
 */
export type ChatItem =
  | { kind: 'user'; key: string; text: string; images: string[] }
  | { kind: 'text'; key: string; text: string }
  | { kind: 'thinking'; key: string; uuid: string; text: string }
  | { kind: 'tool'; key: string; name: string; input: unknown; result: { content: string; isError: boolean } | null }
  | { kind: 'interrupted'; key: string }

const INTERRUPTED = /^\[Request interrupted by user[^\]]*\]$/

/** `persisted` (read from the file) followed by whichever `live` messages it does not have yet. */
export function mergeLive(persisted: TranscriptMessage[], live: TranscriptMessage[]): TranscriptMessage[] {
  if (live.length === 0) return persisted
  const seen = new Set(persisted.map((m) => m.uuid))
  const fresh = live.filter((m) => !seen.has(m.uuid))
  return fresh.length === 0 ? persisted : [...persisted, ...fresh]
}

export function chatItems(messages: TranscriptMessage[]): ChatItem[] {
  const results = new Map<string, { content: string; isError: boolean }>()
  for (const m of messages) {
    for (const b of m.blocks) if (b.type === 'tool_result') results.set(b.toolUseId, { content: b.content, isError: b.isError })
  }
  const items: ChatItem[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      const text = m.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim()
      const images = m.blocks.flatMap((b) => (b.type === 'image' ? [b.dataUrl] : []))
      if (INTERRUPTED.test(text)) items.push({ kind: 'interrupted', key: m.uuid })
      else if (text !== '' || images.length > 0) items.push({ kind: 'user', key: m.uuid, text, images })
      continue
    }
    m.blocks.forEach((b, i) => {
      const key = `${m.uuid}:${String(i)}`
      if (b.type === 'text' && b.text.trim() !== '') items.push({ kind: 'text', key, text: b.text })
      else if (b.type === 'thinking') items.push({ kind: 'thinking', key, uuid: m.uuid, text: b.text })
      else if (b.type === 'tool_use') items.push({ kind: 'tool', key, name: b.name, input: b.input, result: results.get(b.id) ?? null })
    })
  }
  return items
}

/** The latest message you sent, for the box that stays at the top while you scroll. */
export function lastPrompt(items: ChatItem[]): Extract<ChatItem, { kind: 'user' }> | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind === 'user') return item
  }
  return null
}

function field(input: unknown, name: string): string | null {
  if (input === null || typeof input !== 'object') return null
  const v = (input as Record<string, unknown>)[name]
  return typeof v === 'string' && v !== '' ? v : null
}

/**
 * What a tool row says about its call: a one-line `title` beside the tool's name, and the `input`
 * shown in its IN box — the command for Bash, the path for the file tools, the pattern for a
 * search, and the whole input otherwise.
 */
export function describeTool(name: string, input: unknown): { title: string; input: string } {
  const json = (): string => {
    try { return JSON.stringify(input, null, 2) } catch { return String(input) }
  }
  const path = field(input, 'file_path') ?? field(input, 'notebook_path') ?? field(input, 'path')
  const base = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
  switch (name) {
    case 'Bash':
      return { title: field(input, 'description') ?? '', input: field(input, 'command') ?? json() }
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit':
      return { title: path !== null ? base(path) : '', input: path ?? json() }
    case 'Grep': case 'Glob': {
      const pattern = field(input, 'pattern') ?? ''
      return { title: pattern, input: path !== null ? `${pattern}  in ${path}` : pattern }
    }
    case 'WebFetch':
      return { title: field(input, 'url') ?? '', input: field(input, 'prompt') ?? json() }
    case 'WebSearch':
      return { title: field(input, 'query') ?? '', input: field(input, 'query') ?? json() }
    case 'Task': case 'Agent':
      return { title: field(input, 'description') ?? '', input: field(input, 'prompt') ?? json() }
    default:
      return { title: field(input, 'description') ?? '', input: json() }
  }
}
