import type { WindowLayoutRecord } from './sessionLayoutStore'

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
