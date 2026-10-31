import type { ResidentMessage, ResidentMessagePush, SessionHit } from '@shared/domain/residents'
import { createKeyedIpcStore } from './createIpcStore'
import { surface } from './policy'

/** One resident's visible chat, oldest first. */
interface ResidentHistory {
  residentId: string
  messages: ResidentMessage[]
}

/** The history with `message` added, or replacing the one with its id in place (a streamed answer's updates). */
export function upsertMessage(messages: readonly ResidentMessage[], message: ResidentMessage): ResidentMessage[] {
  const at = messages.findIndex((m) => m.id === message.id)
  return at < 0 ? [...messages, message] : messages.map((m, i) => (i === at ? message : m))
}

/*
 * Each resident's chat, by resident id: read with `residentHistory` when a key's first reader
 * arrives (a popup opening), then kept current by `residentMessage`, which every window hears, so
 * the chat is the same in each. A push for a resident nobody reads is ignored; one that arrives
 * before the first answer re-reads it rather than guessing at what came before.
 */
const historyStore = createKeyedIpcStore<ResidentHistory | null>({
  scope: 'residents',
  initial: null,
  fetch: async (residentId) => ({ residentId, messages: await window.apiary.residentHistory(residentId) }),
  subscribe: (push, invalidate) => window.apiary.onResidentMessage(({ residentId, message }: ResidentMessagePush) => {
    const current = historyStore.getSnapshot(residentId)
    if (current === null) invalidate(residentId)
    else push({ residentId, messages: upsertMessage(current.messages, message) })
  }),
  keysOf: (history) => (history === null ? [] : [history.residentId]),
})

/** The resident's chat, oldest first; `[]` until it has been read (and for an unknown resident). */
export function useResidentHistory(residentId: string): ResidentMessage[] {
  return historyStore.useStore(residentId, (history) => history?.messages ?? EMPTY)
}
const EMPTY: ResidentMessage[] = []

/** False until the resident's chat has been read once: an empty chat before then means "not known yet". */
export const useResidentHistoryLoaded = historyStore.useLoaded

/**
 * Sends `text` to the resident (returned policy: the composer awaits it and shows a refusal inline,
 * with `describeError`). Resolves with up to three sessions the index matched at once, before the
 * resident's own answer streams in through `useResidentHistory`.
 */
export function sendToResident(residentId: string, text: string): Promise<SessionHit[]> {
  return window.apiary.residentSend(residentId, text)
}

/** Stops the resident's running turn; what it wrote so far stays in the chat. */
export function stopResident(residentId: string): void {
  surface(window.apiary.residentStop(residentId), 'Could not stop the resident')
}

/** Empties the resident's chat and makes it forget the conversation; every reader sees it empty. */
export function clearResident(residentId: string): void {
  surface(window.apiary.residentClear(residentId).then(() => historyStore.refresh(residentId)), 'Could not clear the history')
}

/**
 * Allows or denies a tool use the resident is waiting on (one of `ResidentStatus.permissions`).
 * The request leaves `permissions` through the next `residentsChanged`; an id already answered is
 * ignored by main. Failure is surfaced.
 */
export function answerPermission(residentId: string, requestId: string, allow: boolean): void {
  surface(window.apiary.residentPermissionAnswer(residentId, requestId, allow), 'Could not answer the request')
}

/**
 * Runs one of the kind's own quick actions (`ResidentStatus.quickActions`, the right-click menu).
 * A prompt action arrives in the chat as if typed; a command's output (or a short error) arrives as
 * an assistant message, both through `useResidentHistory`. Failure is surfaced.
 */
export function runQuickAction(residentId: string, actionId: string): void {
  surface(window.apiary.residentQuickAction(residentId, actionId), 'Could not run the action')
}

/** The user opened the resident's popup: clears what it flagged (`attention`) in every window. */
export function markResidentSeen(residentId: string): void {
  surface(window.apiary.residentSeen(residentId), 'Could not mark the resident as seen')
}

/** Forgets every topic digest and digests all sessions again (Settings → Re-digest everything, after a confirmation). */
export function redigestResident(residentId: string): void {
  surface(window.apiary.residentRedigest(residentId), 'Could not start the digest again')
}
