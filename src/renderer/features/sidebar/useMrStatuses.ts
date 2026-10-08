import { useEffect, useMemo, useState } from 'react'
import type { SessionId } from '@shared/domain/ids'
import { parseMrRefs } from '@shared/mrRefs'
import type { MrState } from './mrRefText'
import { currentMrStatuses, subscribeMrStatuses } from '../../state/mrStatusStore'

/**
 * Resolves the `!<iid>` references named in `text` to their merge-request states.
 *
 * Shared rather than written per row because the Active section needs exactly what a session row
 * needs, and having only the row know how to do this is what let Active show a bare title for a
 * session that every other section of the sidebar was already labelling `(merged)`. Two places
 * disagreeing about one merge request is worse than neither showing it.
 *
 * An unresolved reference stays plain text: the lookup crosses IPC to `glab`, and a row must not
 * wait on the network to say what it already knows.
 *
 * The timer, the invalidation listener and the request itself live in `mrStatusStore` (UI-10),
 * shared across every mounted call to this hook rather than one of each per call — `SessionRow`
 * alone calls it twice (title and note), which used to mean two timers and two IPC round trips
 * for the same session on every refresh.
 */
export function useMrStatuses(sessionId: SessionId, text: string): Record<number, MrState | null> {
  const refs = useMemo(() => parseMrRefs(text), [text])
  // A stable, primitive dependency: `refs.map(...)` would be a new array (and so a new effect
  // run) on every render even when the referenced iids have not actually changed.
  const iidsKey = refs.map((r) => r.iid).join(',')
  const [statuses, setStatuses] = useState<Record<number, MrState | null>>(
    () => (refs.length === 0 ? {} : currentMrStatuses(sessionId)),
  )

  useEffect(() => {
    if (refs.length === 0) { setStatuses({}); return }
    setStatuses(currentMrStatuses(sessionId))
    return subscribeMrStatuses(sessionId, refs.map((r) => r.iid), setStatuses)
    // `refs` itself is a fresh array every render; `iidsKey` is what actually identifies "the set
    // of merge requests this call cares about hasn't changed".
    // eslint-disable-next-line react-hooks/exhaustive-deps -- iidsKey stands in for refs, see above
  }, [sessionId, iidsKey])

  return statuses
}
