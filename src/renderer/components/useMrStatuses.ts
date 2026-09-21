import { useEffect, useMemo, useState } from 'react'
import { parseMrRefs } from '@shared/mrRefs'
import type { MrState } from './mrRefText'

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
 */
export function useMrStatuses(sessionId: string, text: string): Record<number, MrState | null> {
  const refs = useMemo(() => parseMrRefs(text), [text])
  const [statuses, setStatuses] = useState<Record<number, MrState | null>>({})

  useEffect(() => {
    if (refs.length === 0) { setStatuses({}); return }
    let cancelled = false
    void window.apiary.gitlabMrRefStatus(sessionId, false, refs.map((r) => r.iid))
      .then((result) => { if (!cancelled) setStatuses(result) })
      .catch(() => { /* an unresolved reference just stays plain text */ })
    return () => { cancelled = true }
  }, [sessionId, refs])

  return statuses
}
