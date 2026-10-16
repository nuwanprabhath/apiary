import { useEffect, useMemo, useState } from 'react'
import type { SessionId } from '@shared/domain/ids'
import { parseMrRefs } from '@shared/mrRefs'
import type { MrState } from '../../ui/mrRefText'
import { currentMrStatuses, subscribeMrStatuses } from '../../state/mrStatusStore'

/**
 * An unresolved reference stays plain text: the lookup crosses IPC to `glab`, and a row must not
 * wait on the network to say what it already knows.
 *
 * The timer, the invalidation listener and the request live in `mrStatusStore`, shared across
 * every mounted call (`SessionRow` alone calls this twice, for title and note).
 */
export function useMrStatuses(sessionId: SessionId, text: string): Record<number, MrState | null> {
  const refs = useMemo(() => parseMrRefs(text), [text])
  // A primitive dependency: `refs.map(...)` would be a new array on every render.
  const iidsKey = refs.map((r) => r.iid).join(',')
  const [statuses, setStatuses] = useState<Record<number, MrState | null>>(
    () => (refs.length === 0 ? {} : currentMrStatuses(sessionId)),
  )

  useEffect(() => {
    if (refs.length === 0) { setStatuses({}); return }
    setStatuses(currentMrStatuses(sessionId))
    return subscribeMrStatuses(sessionId, refs.map((r) => r.iid), setStatuses)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- iidsKey stands in for refs, see above
  }, [sessionId, iidsKey])

  return statuses
}
