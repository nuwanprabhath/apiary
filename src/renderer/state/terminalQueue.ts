import type { QueuedMessage } from '@shared/domain/chat'
import type { SessionId } from '@shared/domain/ids'
import { createLocalStore } from './createLocalStore'

/** A message the chat view typed into its session's busy terminal, which Claude has not taken in yet. */
export interface TerminalQueued extends QueuedMessage { inTerminal: true }

const NONE_QUEUED: readonly TerminalQueued[] = []
/** The most kept per session: each is hidden once the transcript has it, so only the newest matter. */
const KEPT = 20

const store = createLocalStore<ReadonlyMap<SessionId, readonly TerminalQueued[]>>(new Map())
let nextId = 0

/**
 * Remembers a message typed into a busy terminal from the chat view. Claude Code takes it in only at
 * its next tool result, and writes it to the file then, so until that the view showed nothing of it
 * and the message looked lost.
 */
export function queueInTerminal(sessionId: SessionId, text: string, now: number = Date.now()): void {
  nextId += 1
  const entry: TerminalQueued = { id: `terminal-${String(nextId)}`, text, sentAt: now, inTerminal: true }
  store.set((current) => {
    const next = new Map(current)
    next.set(sessionId, [...(current.get(sessionId) ?? NONE_QUEUED), entry].slice(-KEPT))
    return next
  })
}

/** What the chat view typed into this session's terminal; `stillQueued` decides which still wait. */
export function useTerminalQueued(sessionId: SessionId): readonly TerminalQueued[] {
  return store.useStore((m) => m.get(sessionId) ?? NONE_QUEUED)
}
