import type { TranscriptMessage } from './domain/transcript'
import { ASK_USER_QUESTION, summarizeQuestions } from './askQuestion'

/**
 * The transcript as the chat view draws it. In the session file a tool call and its result are two
 * messages; here they are paired by tool-use id, and a user message that only carried results
 * disappears into the calls it answered.
 */
export type ChatItem =
  | { kind: 'user'; key: string; text: string; images: string[]; timestampMs: number | null }
  | { kind: 'text'; key: string; text: string; timestampMs: number | null }
  | { kind: 'thinking'; key: string; uuid: string; text: string }
  | { kind: 'tool'; key: string; name: string; input: unknown; result: { content: string; isError: boolean } | null }
  | { kind: 'interrupted'; key: string }
  /** Something Claude Code itself put in the conversation as "you": a background task finishing
   *  (`<task-notification>`), a local command's output. Shown as a quiet line, never as a prompt. */
  | { kind: 'notice'; key: string; text: string; status: string | null }
  /** Another Claude session's message to this one: a subagent's report back, for one. */
  | { kind: 'peer'; key: string; from: string | null; text: string; timestampMs: number | null }
  /** Text a tool loaded into the conversation (a skill's instructions), not something you wrote. */
  | { kind: 'loaded'; key: string; name: string | null; text: string }

const INTERRUPTED = /^\[Request interrupted by user[^\]]*\]$/

/** The text inside `<name>…</name>`, for the fixed tag names below (never user input). */
function tag(name: string, text: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)
  return m === null ? null : m[1].trim()
}

/**
 * A user message Claude Code wrote rather than you, as what the chat shows for it — or null for
 * one you wrote. `<task-notification>` is a background task reporting back; a slash command is
 * recorded as tags (`<command-name>`, `<command-args>`) and its output as `<local-command-stdout>`;
 * the caveat it adds before them is noise.
 */
function synthetic(text: string): { kind: 'notice'; text: string; status: string | null } | { kind: 'command'; text: string } | { kind: 'skip' } | null {
  if (!text.startsWith('<')) return null
  if (text.startsWith('<task-notification>')) {
    return { kind: 'notice', text: tag('summary', text) ?? 'A background task finished', status: tag('status', text) }
  }
  if (text.startsWith('<local-command-caveat>')) return { kind: 'skip' }
  if (text.startsWith('<command-name>') || text.startsWith('<command-message>')) {
    const name = tag('command-name', text)
    if (name === null) return { kind: 'skip' }
    const args = tag('command-args', text) ?? ''
    return { kind: 'command', text: args === '' ? name : `${name} ${args}` }
  }
  if (text.startsWith('<local-command-stdout>') || text.startsWith('<local-command-stderr>')) {
    const out = tag('local-command-stdout', text) ?? tag('local-command-stderr', text) ?? ''
    return out === '' ? { kind: 'skip' } : { kind: 'notice', text: out, status: null }
  }
  return null
}

/**
 * `persisted` (read from the file) followed by the `live` messages that are newer than it and it does
 * not have yet. `live` keeps a chat's newest 200 messages of the whole run, while `persisted` may hold
 * only the file's newest page (a window opened later, or one that trimmed its oldest): live messages
 * from before that page must not be appended, or they show below the newest ones. So only what follows
 * the last live message the file part has is new; with none in common, only live messages no older
 * than the file part's newest.
 */
export function mergeLive(persisted: TranscriptMessage[], live: TranscriptMessage[]): TranscriptMessage[] {
  if (live.length === 0) return persisted
  const seen = new Set(persisted.map((m) => m.uuid))
  let anchor = -1
  for (let i = live.length - 1; i >= 0; i--) if (seen.has(live[i].uuid)) { anchor = i; break }
  const newest = persisted.reduce<number | null>((t, m) => (m.timestampMs !== null && (t === null || m.timestampMs > t) ? m.timestampMs : t), null)
  const fresh = anchor >= 0
    ? live.slice(anchor + 1).filter((m) => !seen.has(m.uuid))
    : live.filter((m) => !seen.has(m.uuid) && (newest === null || m.timestampMs === null || m.timestampMs >= newest))
  return fresh.length === 0 ? persisted : [...persisted, ...fresh]
}

/** Both clocks are this machine's; this only covers a timestamp rounded down. */
const SAME_MACHINE_SLACK_MS = 1000

/**
 * The queued messages the conversation does not show yet. Claude writes a message it takes in to
 * the session file before it replays it on stdout (0.5–0.9 s before, measured on 2.1.291), so the
 * file's copy can reach the transcript while the message is still queued, and it showed twice.
 * A queued message is matched by its text to a message of yours written since it was sent, each
 * one matching at most one.
 */
export function stillQueued<Q extends { text: string; sentAt: number }>(queued: Q[], messages: TranscriptMessage[]): Q[] {
  if (queued.length === 0) return queued
  const used = new Set<TranscriptMessage>()
  const textOf = (m: TranscriptMessage): string => m.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim()
  const left = queued.filter((q) => {
    const match = messages.find((m) => m.role === 'user' && !used.has(m) && m.timestampMs !== null
      && m.timestampMs >= q.sentAt - SAME_MACHINE_SLACK_MS && textOf(m) === q.text.trim())
    if (match === undefined) return true
    used.add(match)
    return false
  })
  return left.length === queued.length ? queued : left
}

export function chatItems(messages: TranscriptMessage[]): ChatItem[] {
  const results = new Map<string, { content: string; isError: boolean }>()
  for (const m of messages) {
    for (const b of m.blocks) if (b.type === 'tool_result') results.set(b.toolUseId, { content: b.content, isError: b.isError })
  }
  const items: ChatItem[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      const peer = m.blocks.find((b) => b.type === 'peer_message')
      if (peer !== undefined) { items.push({ kind: 'peer', key: m.uuid, from: peer.from, text: peer.text, timestampMs: m.timestampMs }); continue }
      const loaded = m.blocks.find((b) => b.type === 'loaded_context')
      if (loaded !== undefined) { items.push({ kind: 'loaded', key: m.uuid, name: loaded.name, text: loaded.text }); continue }
      const text = m.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim()
      const images = m.blocks.flatMap((b) => (b.type === 'image' ? [b.dataUrl] : []))
      const made = synthetic(text)
      if (INTERRUPTED.test(text)) items.push({ kind: 'interrupted', key: m.uuid })
      else if (made?.kind === 'notice') items.push({ kind: 'notice', key: m.uuid, text: made.text, status: made.status })
      else if (made?.kind === 'command') items.push({ kind: 'user', key: m.uuid, text: made.text, images, timestampMs: m.timestampMs })
      else if (made === null && (text !== '' || images.length > 0)) items.push({ kind: 'user', key: m.uuid, text, images, timestampMs: m.timestampMs })
      continue
    }
    m.blocks.forEach((b, i) => {
      const key = `${m.uuid}:${String(i)}`
      if (b.type === 'text' && b.text.trim() !== '') items.push({ kind: 'text', key, text: b.text, timestampMs: m.timestampMs })
      else if (b.type === 'thinking') items.push({ kind: 'thinking', key, uuid: m.uuid, text: b.text })
      else if (b.type === 'tool_use') items.push({ kind: 'tool', key, name: b.name, input: b.input, result: results.get(b.id) ?? null })
    })
  }
  return items
}

/**
 * The conversation without its tool calls: every `tool_use` and `tool_result` block gone, and a
 * message that carried nothing else gone with it (an assistant turn that only ran a command, the
 * user-role message that only held its result). What is left is what you said and what Claude said.
 * A message with no tool block is returned as is, so a memoised row keeps its identity.
 */
export function withoutToolCalls(messages: TranscriptMessage[]): TranscriptMessage[] {
  const isTool = (b: TranscriptMessage['blocks'][number]): boolean => b.type === 'tool_use' || b.type === 'tool_result'
  return messages.flatMap((m) => {
    if (!m.blocks.some(isTool)) return [m]
    const blocks = m.blocks.filter((b) => !isTool(b))
    return blocks.length === 0 ? [] : [{ ...m, blocks }]
  })
}

/** What you sent in a session, newest first, for the message box's ↑/↓ history. A message sent
 *  several times in a row is one entry, as a shell's history keeps it. */
export function sentPrompts(messages: TranscriptMessage[]): string[] {
  const out: string[] = []
  for (const item of chatItems(messages)) {
    if (item.kind === 'user' && item.text !== '' && item.text !== out[0]) out.unshift(item.text)
  }
  return out
}

/** The latest message you sent, for the box that stays at the top while you scroll. */
export function lastPrompt(items: ChatItem[]): Extract<ChatItem, { kind: 'user' }> | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind === 'user') return item
  }
  return null
}

export interface BackgroundTask {
  taskId: string
  description: string
  /** A shell command (`Bash`) or a subagent (`Agent`/`Task`). */
  kind: 'shell' | 'agent'
  /** The command a shell task runs; null for an agent, or when the stream did not say. */
  command: string | null
  /** When the call that started it was written; null when not known. */
  startedAtMs: number | null
}

/** The end of a background task's output, as main read it: its last lines (a shell's output, an
 *  agent's latest steps), or not available (no file the session names, or one main will not read). */
export interface BackgroundTaskOutput {
  available: boolean
  lines: string[]
}

/** A shell's result: "Command running in background with ID: bluctp9gs. Output is being written
 *  to: …". A background agent's: "Async agent launched successfully.\nagentId: a4f9c2e1b (…)". */
const STARTED_IN_BACKGROUND = /(?:running in background with ID|agentId): ([A-Za-z0-9_-]+)/
/** Where the task writes, as the same result says ("Output is being written to:" for a shell,
 *  "output_file:" for an agent). */
const OUTPUT_FILE = /(?:Output is being written to|output_file): (\S+?\.output)\b/
/** The tools that stop a task: `TaskStop` (`task_id`), and `KillShell` (`shell_id`) before it. A
 *  stopped task gets no `<task-notification>`, so its successful result is what ends it. */
const STOP_TOOLS: Partial<Record<string, string>> = { TaskStop: 'task_id', KillShell: 'shell_id' }

type PendingCall = { kind: 'start'; task: Omit<BackgroundTask, 'taskId'> } | { kind: 'stop'; taskId: string }

/**
 * Folds messages into the background tasks still running, a batch at a time. A call and its
 * result can fall in different batches, so a call waits here until its result arrives. A task ends
 * with its `<task-notification>`, or with a stop call (`TaskStop`) whose result is not an error.
 */
export class BackgroundTaskTally {
  private readonly calls = new Map<string, PendingCall>()
  private readonly started = new Map<string, BackgroundTask>()
  /** Each task's output file as its start result named it, kept after the task ends. */
  private readonly outputs = new Map<string, { path: string; kind: BackgroundTask['kind'] }>()

  add(messages: TranscriptMessage[]): void {
    for (const m of messages) {
      for (const b of m.blocks) {
        if (b.type === 'tool_use') this.call(b.id, b.name, b.input, m.timestampMs)
        else if (b.type === 'tool_result') this.result(b.toolUseId, b.content, b.isError)
        else if (b.type === 'text' && b.text.startsWith('<task-notification>')) {
          for (const done of b.text.matchAll(/<task-id>([^<]+)<\/task-id>/g)) this.started.delete(done[1].trim())
        }
      }
    }
  }

  private call(id: string, name: string, input: unknown, timestampMs: number | null): void {
    const stopField = STOP_TOOLS[name]
    if (stopField !== undefined) {
      const taskId = field(input, stopField)
      if (taskId !== null) this.calls.set(id, { kind: 'stop', taskId })
      return
    }
    if (input === null || typeof input !== 'object' || (input as Record<string, unknown>).run_in_background !== true) return
    const command = field(input, 'command')
    const kind = name === 'Agent' || name === 'Task' ? 'agent' : 'shell'
    this.calls.set(id, { kind: 'start', task: { description: field(input, 'description') ?? command ?? name, kind, command, startedAtMs: timestampMs } })
  }

  private result(toolUseId: string, content: string, isError: boolean): void {
    const call = this.calls.get(toolUseId)
    if (call === undefined) return
    this.calls.delete(toolUseId)
    if (call.kind === 'stop') {
      if (!isError) this.started.delete(call.taskId)
      return
    }
    const id = STARTED_IN_BACKGROUND.exec(content)?.[1]
    if (id === undefined) return
    this.started.set(id, { taskId: id, ...call.task })
    const output = OUTPUT_FILE.exec(content)?.[1]
    if (output !== undefined) this.outputs.set(id, { path: output, kind: call.task.kind })
  }

  tasks(): BackgroundTask[] {
    return [...this.started.values()]
  }

  /** The output file the task's start result named, as written there; main confines it before reading. */
  outputFile(taskId: string): { path: string; kind: BackgroundTask['kind'] } | null {
    return this.outputs.get(taskId) ?? null
  }
}

/**
 * The background tasks still running, as far as the session file says: a call made with
 * `run_in_background` whose result names the task, with no `<task-notification>` for that task
 * since. A task that ended with its process is reported too — Claude Code writes one notification
 * for all of them ("didn't finish before the previous session ended") when the session resumes —
 * but one that ended while nothing was running stays listed until then, so callers only ask while
 * the session's claude is running.
 */
export function runningBackgroundTasks(messages: TranscriptMessage[]): BackgroundTask[] {
  const tally = new BackgroundTaskTally()
  tally.add(messages)
  return tally.tasks()
}

/**
 * claude's own list of running tasks (a chat's `background_tasks_changed`), which decides what is
 * running, with what the session file knows about each (the command, when its call was made).
 */
export function withFileDetails(running: BackgroundTask[], fromFile: BackgroundTask[]): BackgroundTask[] {
  if (fromFile.length === 0) return running
  return running.map((t) => {
    const f = fromFile.find((x) => x.taskId === t.taskId)
    return f === undefined ? t : { ...t, command: f.command ?? t.command, startedAtMs: f.startedAtMs ?? t.startedAtMs }
  })
}

/**
 * What the line above the message box says about the latest turn: how long it took and when it
 * ended (Claude Code's `turn_duration`), and the recap it wrote, when one came after it — each
 * only if nothing you sent has come since.
 */
export function latestTurn(messages: TranscriptMessage[]): { durationMs: number | null; endedAtMs: number | null; recap: string | null } {
  let durationMs: number | null = null
  let endedAtMs: number | null = null
  let recap: string | null = null
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    const block = m.blocks[0] as TranscriptMessage['blocks'][number] | undefined
    if (block?.type === 'recap') { recap ??= block.text; continue }
    if (block?.type === 'turn_end') { durationMs = block.durationMs; endedAtMs = m.timestampMs; break }
    if (m.role === 'user' && m.blocks.some((b) => b.type === 'text' && !b.text.startsWith('<'))) break
  }
  return { durationMs, endedAtMs, recap }
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
    case ASK_USER_QUESTION:
      return { title: field(input, 'description') ?? '', input: summarizeQuestions(input) ?? json() }
    default:
      return { title: field(input, 'description') ?? '', input: json() }
  }
}
