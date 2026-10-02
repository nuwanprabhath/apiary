import {
  isChatEffort, type ChatCommand, type ChatDecision, type ChatEffort, type ChatModelInfo, type ChatPermissionRequest, type ChatState,
} from '@shared/domain/chat'
import type { BackgroundTask } from '@shared/chatTimeline'
import { toMessage } from '../transcript/transcriptReader'

/**
 * Claude Code's stream-json protocol, as the VS Code extension's Agent SDK speaks it — measured
 * against `claude` 2.1.286, not taken from documentation:
 *
 * - We write one JSON object per line: `user` messages, and `control_request`s
 *   (`interrupt`, `set_permission_mode`, `set_model`).
 * - It writes one per line: `system` (`init` carries the model and permission mode), `stream_event`
 *   (the API's own streaming events, for text as it is written), whole `assistant`/`user` messages
 *   (with the same `uuid`s the session's JSONL gets), `control_request` `can_use_tool` (a permission
 *   prompt, answered with a `control_response`), `control_cancel_request`, and `result` at the end
 *   of every turn.
 *
 * Everything here is pure; `chatSession.ts` owns the process.
 */

export type Line = Record<string, unknown>

/** At most this many streamed messages are kept; the transcript has long since read older ones. */
const MAX_LIVE = 200

/** A line from stdout as an object, or null. A login shell can print before `exec`, so non-JSON
 *  lines are expected and ignored rather than treated as a broken stream. */
export function parseLine(line: string): Line | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const value: unknown = JSON.parse(trimmed)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Line : null
  } catch {
    return null
  }
}

export function userLine(text: string): Line {
  return {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
    session_id: '',
  }
}

export function controlLine(requestId: string, request: Line): Line {
  return { type: 'control_request', request_id: requestId, request }
}

/** What a permission prompt carried that the reply needs back, but the renderer does not. */
export interface PendingPermission {
  input: unknown
  suggestions: unknown[]
}

/** What Claude is told when a tool is refused: the user's reason, or a plain refusal for none. */
function denyMessage(reason: string | undefined): string {
  const trimmed = reason?.trim() ?? ''
  return trimmed === '' ? 'The user declined this.' : trimmed
}

export function permissionReply(requestId: string, decision: ChatDecision, pending: PendingPermission): Line {
  const response = decision.behavior === 'allow'
    ? {
        behavior: 'allow',
        updatedInput: pending.input,
        ...(decision.always === true && pending.suggestions.length > 0 ? { updatedPermissions: pending.suggestions } : {}),
      }
    : { behavior: 'deny', message: denyMessage(decision.message) }
  return { type: 'control_response', response: { subtype: 'success', request_id: requestId, response } }
}

/** The permission prompt in a `can_use_tool` request, or null for any other control request. */
export function permissionRequestOf(event: Line): { request: ChatPermissionRequest; pending: PendingPermission } | null {
  if (event.type !== 'control_request' || typeof event.request_id !== 'string') return null
  const req = event.request as Line | undefined
  if (req?.subtype !== 'can_use_tool') return null
  const suggestions = Array.isArray(req.permission_suggestions) ? req.permission_suggestions as unknown[] : []
  return {
    request: {
      requestId: event.request_id,
      toolName: typeof req.tool_name === 'string' ? req.tool_name : 'tool',
      description: typeof req.description === 'string' ? req.description : '',
      input: req.input,
      canAlwaysAllow: suggestions.length > 0,
    },
    pending: { input: req.input, suggestions },
  }
}

/** claude's slash commands, from its answer to `initialize` (`response.commands`). */
export function commandsOf(response: unknown): ChatCommand[] | null {
  const commands = (response as { commands?: unknown } | null)?.commands
  if (!Array.isArray(commands)) return null
  return commands.flatMap((c: unknown): ChatCommand[] => {
    if (c === null || typeof c !== 'object') return []
    const r = c as Record<string, unknown>
    if (typeof r.name !== 'string' || r.name === '') return []
    return [{
      name: r.name,
      description: typeof r.description === 'string' ? r.description : '',
      argumentHint: typeof r.argumentHint === 'string' ? r.argumentHint : '',
    }]
  })
}

/** claude's model list, from its answer to `initialize` (`response.models`). */
export function modelsOf(response: unknown): ChatModelInfo[] | null {
  const models = (response as { models?: unknown } | null)?.models
  if (!Array.isArray(models)) return null
  return models.flatMap((m: unknown): ChatModelInfo[] => {
    if (m === null || typeof m !== 'object') return []
    const r = m as Record<string, unknown>
    if (typeof r.value !== 'string' || typeof r.displayName !== 'string') return []
    return [{
      value: r.value,
      displayName: r.displayName,
      description: typeof r.description === 'string' ? r.description : '',
      ...(typeof r.resolvedModel === 'string' ? { resolvedModel: r.resolvedModel } : {}),
      efforts: Array.isArray(r.supportedEffortLevels) ? r.supportedEffortLevels.filter(isChatEffort) : [],
    }]
  })
}

/**
 * What is really in effect, from claude's answer to `get_settings`: `applied.model` is the model
 * the session runs (a resumed session keeps the one it last used, whatever settings.json says),
 * and the effort is `applied.effort`, else the effective `effortLevel`.
 */
export function appliedOf(response: unknown): { model: string | null; effort: ChatEffort | null } {
  const r = (response ?? {}) as { applied?: { model?: unknown; effort?: unknown }; effective?: { effortLevel?: unknown } }
  const model = typeof r.applied?.model === 'string' ? r.applied.model : null
  const effort = isChatEffort(r.applied?.effort) ? r.applied.effort : isChatEffort(r.effective?.effortLevel) ? r.effective.effortLevel : null
  return { model, effort }
}

function contextOf(message: Line | undefined): number | null {
  const usage = message?.usage as Record<string, unknown> | undefined
  if (usage === undefined) return null
  const n = (k: string): number => (typeof usage[k] === 'number' ? usage[k] : 0)
  const total = n('input_tokens') + n('cache_read_input_tokens') + n('cache_creation_input_tokens')
  return total > 0 ? total : null
}

function windowOf(result: Line): number | null {
  const usage = result.modelUsage as Record<string, { contextWindow?: unknown }> | undefined
  if (usage === undefined) return null
  const windows = Object.values(usage).map((u) => u.contextWindow).filter((w): w is number => typeof w === 'number')
  return windows.length > 0 ? Math.max(...windows) : null
}

const NOT_THINKING = { thinking: false, thinkingSince: null, thinkingTokens: null } as const

/**
 * Busy, from the first sign of a turn. Not every turn is one we started: when a background task
 * finishes, claude tells Claude and a turn starts on its own, with nothing sent.
 */
function working(state: ChatState, now: number): ChatState {
  if (state.status === 'busy' || state.status === 'exited') return state
  return { ...state, status: 'busy', turnStartedAt: state.turnStartedAt ?? now }
}

function backgroundTasksOf(tasks: unknown[]): BackgroundTask[] {
  return tasks.flatMap((t: unknown): BackgroundTask[] => {
    if (t === null || typeof t !== 'object') return []
    const r = t as Record<string, unknown>
    if (typeof r.task_id !== 'string') return []
    return [{ taskId: r.task_id, description: typeof r.description === 'string' ? r.description : '' }]
  })
}

/** What claude's answer to `get_context_usage` says: tokens in context, and the window's size. */
export function contextUsageOf(response: unknown): { used: number; window: number } | null {
  const r = (response ?? {}) as { totalTokens?: unknown; maxTokens?: unknown }
  if (typeof r.totalTokens !== 'number' || typeof r.maxTokens !== 'number' || r.maxTokens <= 0) return null
  return { used: r.totalTokens, window: r.maxTokens }
}

/** The next state after one line of `claude`'s output. Unknown lines leave it as it was. */
export function reduce(state: ChatState, event: Line, now: number = Date.now()): ChatState {
  switch (event.type) {
    case 'system':
      // Claude's own running estimate while it thinks (the thinking text itself is not sent).
      if (event.subtype === 'thinking_tokens' && state.streaming?.thinking === true && typeof event.estimated_tokens === 'number') {
        return { ...state, streaming: { ...state.streaming, thinkingTokens: event.estimated_tokens } }
      }
      if (event.subtype === 'background_tasks_changed' && Array.isArray(event.tasks)) {
        return { ...state, backgroundTasks: backgroundTasksOf(event.tasks) }
      }
      if (event.subtype === 'init') {
        return {
          ...state,
          model: typeof event.model === 'string' ? event.model : state.model,
          permissionMode: typeof event.permissionMode === 'string' ? event.permissionMode : state.permissionMode,
        }
      }
      return state
    case 'stream_event': {
      const e = event.event as Line | undefined
      // Subagents stream too; only the main conversation's own reply is shown as it is written.
      if (e === undefined || event.parent_tool_use_id) return state
      if (e.type === 'message_start') return { ...working(state, now), streaming: { text: '', ...NOT_THINKING } }
      if (e.type === 'content_block_start') {
        const block = e.content_block as Line | undefined
        const text = state.streaming?.text ?? ''
        return {
          ...state,
          streaming: block?.type === 'thinking'
            ? { text, thinking: true, thinkingSince: now, thinkingTokens: null }
            : { ...(state.streaming ?? NOT_THINKING), text, thinking: false },
        }
      }
      if (e.type === 'content_block_delta') {
        const delta = e.delta as Line | undefined
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          return { ...state, streaming: { ...(state.streaming ?? NOT_THINKING), text: (state.streaming?.text ?? '') + delta.text, thinking: false } }
        }
      }
      return state
    }
    case 'assistant':
    case 'user': {
      const message = toMessage(event)
      if (message === null || message.uuid === '' || state.live.some((m) => m.uuid === message.uuid)) return state
      const live = [...state.live, message].slice(-MAX_LIVE)
      if (event.type === 'user') {
        // A message we sent, now read: claude replays it (`isReplay`) at the point it took it in.
        if (event.isReplay !== true) return { ...state, live }
        const text = message.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
        const at = state.queued.findIndex((q) => q.text === text)
        return { ...state, live, queued: at < 0 ? state.queued : state.queued.filter((_, i) => i !== at) }
      }
      // A whole block has arrived, so what was being streamed for it is now in `live`. A thinking
      // block keeps how long it took, which the session file never records.
      const used = contextOf(event.message as Line | undefined)
      const since = state.streaming?.thinkingSince ?? null
      const thoughts = message.blocks.some((b) => b.type === 'thinking') && since !== null
        ? { ...state.thoughts, [message.uuid]: { seconds: Math.max(1, Math.round((now - since) / 1000)), tokens: state.streaming?.thinkingTokens ?? null } }
        : state.thoughts
      return { ...working(state, now), live, thoughts, streaming: null, contextUsed: used ?? state.contextUsed }
    }
    case 'control_request': {
      const prompt = permissionRequestOf(event)
      if (prompt === null || state.permissions.some((p) => p.requestId === prompt.request.requestId)) return state
      return { ...state, permissions: [...state.permissions, prompt.request] }
    }
    case 'control_cancel_request':
      return { ...state, permissions: state.permissions.filter((p) => p.requestId !== event.request_id) }
    case 'result': {
      // A local command (`/context`) is answered without being replayed, so it would sit in the
      // queue for good; the turn that answered it is this one.
      const queued = state.queued.filter((q) => !q.text.startsWith('/'))
      const more = queued.length > 0 && state.status !== 'exited'
      const startedAt = state.turnStartedAt
      return {
        ...state,
        status: state.status === 'exited' ? 'exited' : more ? 'busy' : 'idle',
        streaming: null,
        // Still owed an answer: the next turn starts now, for the working line's clock.
        turnStartedAt: more ? now : null,
        permissions: [],
        queued,
        contextWindow: windowOf(event) ?? state.contextWindow,
        lastTurn: {
          durationMs: typeof event.duration_ms === 'number' ? event.duration_ms : startedAt !== null ? now - startedAt : 0,
          endedAt: now,
        },
      }
    }
    default:
      return state
  }
}
