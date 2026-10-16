import type { MrState } from '@shared/domain/git'
import type { SessionId } from '@shared/domain/ids'
import { background } from './policy'
import { rebindOnNewBridge } from './bridgeBinding'

/**
 * One shared timer, one shared `onMrStatusesInvalidated` listener, and one `gitlabMrRefStatus`
 * request per session per tick. `SessionRow` alone calls the hook twice (title and note); this
 * unions whatever every mounted consumer for a session is asking about into one request.
 *
 * A plain module store, so subscribe calls landing in one render can be coalesced (`scheduleFetch`).
 */

type Listener = (statuses: Record<number, MrState | null>) => void

interface Consumer {
  iids: number[]
  listener: Listener
}

interface SessionEntry {
  consumers: Map<symbol, Consumer>
  statuses: Record<number, MrState | null>
  fetchScheduled: boolean
}

/** How often a session with something mounted re-asks; the main process's cache decides whether
 *  re-asking actually reaches GitLab. */
const REFRESH_MS = 2 * 60 * 1000

const sessions = new Map<SessionId, SessionEntry>()

/** Notices a new `window.apiary` (a component test's fresh fake) on the next subscribe rather than
 *  keep talking to a bridge no test can see any more. */
const ensureBound = rebindOnNewBridge((api) => {
  const unsubInvalidated = api.onMrStatusesInvalidated(() => { refetchAll() })
  const timer = setInterval(refetchAll, REFRESH_MS)
  return () => { unsubInvalidated(); clearInterval(timer) }
})

function refetchAll(): void {
  for (const sessionId of sessions.keys()) scheduleFetch(sessionId)
}

function scheduleFetch(sessionId: SessionId): void {
  const entry = sessions.get(sessionId)
  if (entry === undefined || entry.fetchScheduled) return
  entry.fetchScheduled = true
  // Deferred a tick so sibling hooks subscribing in one render share one request.
  queueMicrotask(() => {
    entry.fetchScheduled = false
    const iids = [...new Set([...entry.consumers.values()].flatMap((c) => c.iids))]
    if (iids.length === 0) return
    // A failed lookup is logged; the reference just stays plain text.
    background(window.apiary.gitlabMrRefStatus({ kind: 'session', id: sessionId }, iids)
      .then((result) => {
        entry.statuses = result
        for (const c of entry.consumers.values()) c.listener(result)
      }), 'mr-status')
  })
}

/** This session's most recent fetch result, so a fresh subscriber can paint before its own request lands. */
export function currentMrStatuses(sessionId: SessionId): Record<number, MrState | null> {
  return sessions.get(sessionId)?.statuses ?? {}
}

/**
 * Registers interest in `iids` for `sessionId`. `listener` is called with the full record every
 * time this session's statuses are refreshed (on the shared timer, an invalidation, or — for a
 * fresh set of iids — once immediately). Returns an unsubscribe function.
 */
export function subscribeMrStatuses(sessionId: SessionId, iids: number[], listener: Listener): () => void {
  ensureBound()
  let entry = sessions.get(sessionId)
  if (entry === undefined) {
    entry = { consumers: new Map(), statuses: {}, fetchScheduled: false }
    sessions.set(sessionId, entry)
  }
  const id = Symbol('mr-status-consumer')
  entry.consumers.set(id, { iids, listener })
  if (iids.length > 0) scheduleFetch(sessionId)
  return () => {
    entry?.consumers.delete(id)
    if (entry?.consumers.size === 0) sessions.delete(sessionId)
  }
}
