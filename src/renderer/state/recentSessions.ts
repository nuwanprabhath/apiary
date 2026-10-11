import type { SessionNode } from '@shared/types'

/** Shared state: sessionId -> the timestamp it was dismissed from Recent at. */
export interface DismissedMap { [sessionId: string]: number }

/**
 * Sessions for the Recent section: active inside the window, not pinned, not already shown in
 * Active, not dismissed since their last activity — newest first.
 *
 * A session is hidden by dismissal only while it stays quiet: `lastActiveAtMs <= dismissed[id]`
 * is exactly "nothing has happened here since you dismissed it." Using the session again moves
 * `lastActiveAtMs` past the dismissal timestamp, which is what brings it back without any extra
 * bookkeeping to un-dismiss it.
 */
export function selectRecent(
  sessions: SessionNode[],
  pinnedIds: Set<string>,
  activeIds: Set<string>,
  dismissed: DismissedMap,
  now: number,
  windowHours: number,
): SessionNode[] {
  const windowMs = windowHours * 3600_000
  return sessions
    .filter((s) => s.lastActiveAtMs !== null && now - s.lastActiveAtMs <= windowMs)
    .filter((s) => !pinnedIds.has(s.sessionId) && !activeIds.has(s.sessionId))
    .filter((s) => {
      const at = dismissed[s.sessionId]
      return at === undefined || s.lastActiveAtMs! > at
    })
    .sort((a, b) => (b.lastActiveAtMs ?? 0) - (a.lastActiveAtMs ?? 0))
}

/** Drops dismissals old enough that they could never hide anything again, so the map cannot grow
 *  without bound across months of use. Returns the same reference when nothing changed, so a
 *  caller can skip writing shared state on every render. */
export function pruneDismissed(dismissed: DismissedMap, now: number, windowHours: number): DismissedMap {
  const windowMs = windowHours * 3600_000
  const stale = Object.entries(dismissed).filter(([, at]) => now - at > windowMs)
  if (stale.length === 0) return dismissed
  const next = { ...dismissed }
  for (const [id] of stale) delete next[id]
  return next
}

export function dismissRecent(dismissed: DismissedMap, sessionId: string, at: number): DismissedMap {
  return { ...dismissed, [sessionId]: at }
}
