import type { MrState } from '../features/sidebar/mrRefText'
import type { SessionId } from '@shared/domain/ids'
import { background } from './policy'
import { rebindOnNewBridge } from './bridgeBinding'

/**
 * One shared timer, one shared `onMrStatusesInvalidated` listener, and one `gitlabMrRefStatus`
 * request per session per tick — instead of every mounted `useMrStatuses` owning its own 2-minute
 * `setInterval` and its own invalidation listener (UI-10). `SessionRow` alone calls the hook twice
 * (title and note), which used to mean two separate IPC round trips and two timers for the same
 * session; this unions whatever every mounted consumer for a session is asking about into one
 * request.
 *
 * Kept as a plain module store rather than React state so a title's and a note's subscribe calls,
 * which land in the same render, can be coalesced before either one's request goes out — see
 * `scheduleFetch`'s microtask delay.
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

/** How often a session with something mounted re-asks. Matches the per-row interval this
 *  replaces; the main process's cache decides whether re-asking actually reaches GitLab. */
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
  // Deferred a tick so sibling hooks subscribing in the same render (a row's title and its note)
  // land before the request goes out, and are asked about in one call rather than two.
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

/** Whatever this session's most recent fetch returned, before a new subscriber's own request (if
 *  any) lands — lets a fresh subscriber paint immediately instead of blanking until the round
 *  trip returns. */
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
