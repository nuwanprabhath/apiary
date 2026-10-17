import type { ChatPush, ChatState } from './domain/chat'

/**
 * The push for `next`, given the state pushed before it (`null` for a session's first push). A
 * delta carries the top-level fields whose value is a different object or primitive (`!==`);
 * the state moving to another session (`/clear`) or ending is always sent whole.
 */
export function chatPush(prev: ChatState | null, next: ChatState): ChatPush {
  if (prev === null || next.status === 'exited' || prev.sessionId !== next.sessionId || prev.previousSessionId !== next.previousSessionId) {
    return { kind: 'full', state: next }
  }
  const changes: Record<string, unknown> = {}
  for (const key of Object.keys(next) as (keyof ChatState)[]) {
    if (key !== 'seq' && prev[key] !== next[key]) changes[key] = next[key]
  }
  return {
    kind: 'delta', sessionId: next.sessionId, previousSessionId: next.previousSessionId, base: prev.seq, seq: next.seq,
    changes,
  }
}

/** The state after `push`, or `'refetch'` when it cannot be applied onto `snapshot` (none, or not the one the delta was computed from). */
export function applyChatPush(snapshot: ChatState | null, push: ChatPush): ChatState | 'refetch' {
  if (push.kind === 'full') return push.state
  if (snapshot === null || snapshot.seq !== push.base) return 'refetch'
  return { ...snapshot, ...push.changes, seq: push.seq }
}
