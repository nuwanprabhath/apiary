import type { TranscriptMessage } from './transcript'

/**
 * Chat mode: a session driven the way the VS Code extension drives Claude — `claude` reading and
 * writing JSON lines (`--input-format/--output-format stream-json`) rather than a terminal. Main
 * owns the process (`main/chat/`); the renderer sees one `ChatState` per session and draws it on top
 * of the transcript, which keeps reading the session's own JSONL exactly as before.
 */

/** The permission modes the composer offers, in the extension's order. The CLI accepts more
 *  (`dontAsk`, `bypassPermissions`); those are left to the terminal. */
export const CHAT_PERMISSION_MODES = ['auto', 'manual', 'acceptEdits', 'plan'] as const
export type ChatPermissionMode = (typeof CHAT_PERMISSION_MODES)[number]

export const CHAT_PERMISSION_MODE_LABELS: Record<ChatPermissionMode, string> = {
  auto: 'Auto',
  manual: 'Manual',
  acceptEdits: 'Edit automatically',
  plan: 'Plan',
}

export function isChatPermissionMode(value: unknown): value is ChatPermissionMode {
  return typeof value === 'string' && (CHAT_PERMISSION_MODES as readonly string[]).includes(value)
}

/**
 * A model as `claude --model` / `set_model` takes it: an alias (`default`, `opus`, `haiku`) or a
 * full id (`claude-fable-5-1`). The list a running chat offers comes from claude itself
 * (`ChatState.models`); `CHAT_MODELS` is only what the picker shows before it has started.
 */
export type ChatModel = string
export const CHAT_MODELS: readonly ChatModelInfo[] = [
  { value: 'default', displayName: 'Default (recommended)', description: 'Claude Code’s own choice', efforts: [] },
  { value: 'opus', displayName: 'Opus', description: 'For complex work and everyday tasks', efforts: [] },
  { value: 'sonnet', displayName: 'Sonnet', description: 'Most efficient for simpler tasks', efforts: [] },
  { value: 'haiku', displayName: 'Haiku', description: 'Fastest for quick answers', efforts: [] },
]

/** Safe to put on a command line: what model ids and aliases look like, and nothing else. */
const MODEL_ID = /^[a-zA-Z][a-zA-Z0-9.\-[\]]{0,63}$/
export function isChatModel(value: unknown): value is ChatModel {
  return typeof value === 'string' && MODEL_ID.test(value)
}

/** How hard Claude thinks (`--effort`, `effortLevel`), lowest first. */
export const CHAT_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type ChatEffort = (typeof CHAT_EFFORTS)[number]
export function isChatEffort(value: unknown): value is ChatEffort {
  return typeof value === 'string' && (CHAT_EFFORTS as readonly string[]).includes(value)
}

/** One entry of claude's own model list (its `initialize` answer). */
export interface ChatModelInfo {
  value: string
  displayName: string
  description: string
  /** The model this entry runs, when claude says (`default` → `claude-opus-5-5`). */
  resolvedModel?: string
  /** Effort levels it supports; empty when it has none (Haiku). */
  efforts: ChatEffort[]
}

/** A tool Claude is waiting for permission to use. */
export interface ChatPermissionRequest {
  requestId: string
  toolName: string
  /** What Claude says the call is for (`description` on the request), or ''. */
  description: string
  input: unknown
  /** Claude offered a rule to stop asking (its `permission_suggestions`) — "Always allow" applies it. */
  canAlwaysAllow: boolean
}

export type ChatDecision =
  | { behavior: 'allow'; always?: boolean }
  | { behavior: 'deny'; message?: string }

export function isChatDecision(value: unknown): value is ChatDecision {
  if (value === null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (v.behavior === 'allow') return v.always === undefined || typeof v.always === 'boolean'
  if (v.behavior === 'deny') return v.message === undefined || (typeof v.message === 'string' && v.message.length <= 10_000)
  return false
}

export type ChatStatus = 'starting' | 'idle' | 'busy' | 'exited'

export interface ChatState {
  sessionId: string
  status: ChatStatus
  /** The model the session is actually running (claude's `applied` setting), e.g.
   *  `claude-haiku-4-5-20251001` — not whatever the picker last asked for. */
  model: string | null
  /** The effort level in effect, when the model has one. */
  effort: ChatEffort | null
  /** Every model claude offers, with its effort levels; null until it has said. */
  models: ChatModelInfo[] | null
  permissionMode: string | null
  /**
   * Whole messages streamed this run, oldest first. Each is also written to the session's JSONL;
   * the transcript drops a live one as soon as it has read the same `uuid` from the file.
   */
  live: TranscriptMessage[]
  /** The reply being written right now, before its message is complete. While `thinking`, Claude
   *  is reasoning: `thinkingSince` is when it started, `thinkingTokens` its running estimate. */
  streaming: { text: string; thinking: boolean; thinkingSince: number | null; thinkingTokens: number | null } | null
  /** How long each finished thinking block took, by the uuid of the message that carries it —
   *  only known for thinking seen live; the session file keeps no timing. */
  thoughts: Record<string, { seconds: number; tokens: number | null }>
  /** When the turn in progress started, for the working line's clock; null when idle. */
  turnStartedAt: number | null
  permissions: ChatPermissionRequest[]
  /** Tokens in Claude's context after the latest reply, and the model's window. */
  contextUsed: number | null
  contextWindow: number | null
  /** Why the process stopped, when it stopped on its own. */
  error: string | null
  /** Set when Claude moved this chat onto a new session (`/clear`): the id it was before, so a
   *  window showing that session can follow it to `sessionId`. */
  previousSessionId: string | null
  /** The slash commands claude offers (its `initialize` answer); null until it has said. */
  commands: ChatCommand[] | null
}

export interface ChatCommand {
  name: string
  description: string
  /** What the command takes, e.g. `<phase> [instructions]`; '' when it takes nothing. */
  argumentHint: string
}

export function emptyChatState(sessionId: string): ChatState {
  return {
    sessionId,
    status: 'starting',
    model: null,
    effort: null,
    models: null,
    permissionMode: null,
    live: [],
    streaming: null,
    thoughts: {},
    turnStartedAt: null,
    permissions: [],
    contextUsed: null,
    contextWindow: null,
    error: null,
    previousSessionId: null,
    commands: null,
  }
}

/**
 * The name a model goes by, as the picker shows it: claude's own `displayName` for the entry that
 * runs it (the list's `default` alias aside), else the id tidied up — `claude-haiku-4-5-20251001`
 * reads "Haiku 4.5".
 */
export function modelLabel(model: string | null, models: readonly ChatModelInfo[] | null): string {
  if (model === null) return 'Default model'
  const named = models?.find((m) => m.value !== 'default' && (m.resolvedModel === model || m.value === model))
    ?? models?.find((m) => m.value === model)
  if (named !== undefined) return named.displayName
  const parts = model.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/\[.*\]$/, '').split('-')
  const name = parts.filter((p) => !/^\d+$/.test(p))
  const version = parts.filter((p) => /^\d+$/.test(p))
  const title = name.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  return version.length > 0 ? `${title} ${version.join('.')}` : title
}

export const CHAT_EFFORT_LABELS: Record<ChatEffort, string> = {
  low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max',
}
