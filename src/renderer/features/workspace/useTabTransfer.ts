import { useCallback, useEffect } from 'react'
import { isTabTransfer, type TabTransfer } from '@shared/types'
import { useWorkspace, useWorkspaceDispatch } from './WorkspaceProvider'

/**
 * Moving a tab between windows: adopting one dropped here, letting go of one another window took,
 * focusing one when another window's Active row is clicked — and `transferFor`, everything about an
 * open tab that the window receiving it needs to carry on with it.
 */
export function useTabTransfer(): { transferFor: (key: string) => TabTransfer } {
  const dispatch = useWorkspaceDispatch()
  const { layout, ptyOverrides, shellTabs, activeTerminal } = useWorkspace()
  const columns = layout.panes

  /**
   * A tab dragged from another window has been dropped on this one.
   *
   * It arrives as a bare key with no position: the drop is worked out in the main process from
   * where the pointer was released (there is no drop event in this window to carry an index), so
   * the tab goes to the end of the active column — which is where a tab dropped past the last one
   * would have gone anyway.
   */
  useEffect(() => window.apiary.onTabAdopt((tab) => {
    if (!isTabTransfer(tab)) return
    // The processes first, so that by the time the tab renders it already knows what it runs —
    // one `tab/adopt` carries the pty override, the shells and the tab itself.
    dispatch({ type: 'tab/adopt', transfer: tab })
  }), [dispatch])

  /** Everything about an open tab another window would need to carry on with it. */
  const transferFor = useCallback((key: string): TabTransfer => {
    const ptyId = ptyOverrides.get(key) ?? null
    const shellKey = ptyId ?? key
    return {
      key,
      view: columns.flatMap((c) => c.tabs).find((t) => t.key === key)?.view ?? 'transcript',
      ptyId,
      shells: shellTabs.get(shellKey) ?? [],
      activeShell: activeTerminal.get(shellKey) ?? null,
    }
  }, [ptyOverrides, columns, shellTabs, activeTerminal])

  /**
   * Another window has taken a tab this one was showing, so let go of it.
   *
   * This is what makes dragging a tab between windows a *move*. Opening the same session in two
   * windows on purpose is still allowed — that goes through the sidebar and never announces a
   * claim — so the two gestures stay distinguishable.
   */
  useEffect(() => window.apiary.onTabClaimed((key) => {
    dispatch({ type: 'tab/closeEverywhere', key })
  }), [dispatch])

  /**
   * Another window's Active row was clicked for a tab this window already has open — focus it
   * where it already is, the same "go to it rather than open it again" rule `openSessionTab` uses,
   * just against a bare key instead of a full `SessionNode`.
   */
  useEffect(() => window.apiary.onSelectTab((key) => {
    dispatch({ type: 'tab/focus', key })
  }), [dispatch])

  return { transferFor }
}
