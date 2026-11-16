import type { WindowLayoutRecord } from './sessionLayoutStore'

/** A record a launch reopens: one with a tab. A window that never reported its layout, or was emptied, is not. */
export function isRestorable(record: WindowLayoutRecord): boolean {
  return record.layout.panes.some((p) => p.tabs.length > 0)
}

/**
 * The windows a home machine opens copies of: those open here now, and the ones a launch would
 * reopen. A leftover record (a window that closed before it reported a layout) is neither, and
 * a copy of it would show an empty window for one that does not exist.
 */
export function windowsToMirror(records: readonly WindowLayoutRecord[], open: ReadonlySet<number>): WindowLayoutRecord[] {
  return records.filter((r) => open.has(r.number) || isRestorable(r))
}

/**
 * Drops `live` entries whose session no longer resolves — its transcript was deleted, or its cwd
 * no longer exists (see `AppService.sessionIsResumable`). The *tab* stays either way: restore
 * never fails as a whole because one entry went stale, and a session with a missing pty is still
 * worth showing as a closed tab someone can look at or remove, rather than vanishing silently.
 */
export function pruneStaleLive(
  record: WindowLayoutRecord,
  isResumable: (sessionId: string) => boolean,
): WindowLayoutRecord {
  const live = record.live.filter(isResumable)
  return live.length === record.live.length ? record : { ...record, live }
}
