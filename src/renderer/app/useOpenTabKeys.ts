import { useMemo } from 'react'
import type { Column } from '../state/columns'
import type { PendingTabInfo } from '../features/pane/paneTypes'
import type { PendingSession } from '../features/workspace/workspaceReducer'

/**
 * What the window derives from its columns and pending sessions, each memoized so the components
 * it feeds (every SessionColumn and PaneFiller) get the same reference on a render that changed
 * none of it (UI-1). It also returns `pendingTabInfo` (the labels of the pending tabs), derived
 * from the same `pending` map and memoized for the same reason.
 */
export function useOpenTabKeys(columns: Column[], pending: Map<string, PendingSession>) {
  /** Every session id currently open in some column, so the sidebar can list only the pending
   *  sessions that aren't already reachable as a tab. */
  const openKeys = useMemo(
    () => new Set(columns.flatMap((c) => c.tabs.map((t) => t.key))),
    [columns],
  )

  const openKeysSignature = [...openKeys].sort((a, b) => a.localeCompare(b)).join(' ')

  const pendingTabInfo = useMemo(() => new Map<string, PendingTabInfo>(
    [...pending.values()].map((info) => [
      info.ptyId,
      { ptyId: info.ptyId, cwd: info.cwd, label: info.titleOverride ?? info.label },
    ]),
  ), [pending])

  // Rebuilt only when the set of open keys actually changes, so PaneFiller's own memo (keyed on
  // this set) isn't invalidated by every unrelated render of App.
  const openKeySet = useMemo(
    () => new Set(openKeysSignature === '' ? [] : openKeysSignature.split(' ')),
    [openKeysSignature],
  )

  return { openKeys, openKeySet, pendingTabInfo }
}
