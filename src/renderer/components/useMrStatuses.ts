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
/**
 * How often a row re-asks while it stays on screen. It used to ask once, when it mounted — so a
 * row mounted before a merge request was merged said "opened" for as long as it lived, which for
 * an Active row can be all day. The main process's cache decides whether re-asking reaches GitLab.
 */
const REFRESH_MS = 2 * 60 * 1000

export function useMrStatuses(sessionId: string, text: string): Record<number, MrState | null> {
  const refs = useMemo(() => parseMrRefs(text), [text])
  const [statuses, setStatuses] = useState<Record<number, MrState | null>>({})
  /** Bumped to re-ask: on a timer, and when the Refresh button discards the cache. */
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (refs.length === 0) return
    const bump = (): void => { setGeneration((g) => g + 1) }
    const timer = window.setInterval(bump, REFRESH_MS)
    const off = window.apiary.onMrStatusesInvalidated(bump)
    return () => { window.clearInterval(timer); off() }
  }, [refs])

  useEffect(() => {
    if (refs.length === 0) { setStatuses({}); return }
    let cancelled = false
    void window.apiary.gitlabMrRefStatus(sessionId, false, refs.map((r) => r.iid))
      .then((result) => { if (!cancelled) setStatuses(result) })
      .catch(() => { /* an unresolved reference just stays plain text */ })
    return () => { cancelled = true }
  }, [sessionId, refs, generation])

  return statuses
}
