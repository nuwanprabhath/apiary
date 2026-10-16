import { useCallback, useEffect } from 'react'
import { isTabTransfer, type TabTransfer } from '@shared/types'
import { useWorkspaceDispatch, useWorkspaceStore } from './workspaceContext'
import { onSelectTab, onTabAdopt, onTabClaimed } from '../../state/tabs'

export function useTabTransfer(): { transferFor: (key: string) => TabTransfer } {
  const dispatch = useWorkspaceDispatch()
  const store = useWorkspaceStore()

  // A dropped tab arrives with no position (main works the drop out from where the pointer was
  // released), so it goes to the end of the active column.
  useEffect(() => onTabAdopt((tab) => {
    if (!isTabTransfer(tab)) return
    // One `tab/adopt` carries the pty override, the shells and the tab, so it renders knowing what it runs.
    dispatch({ type: 'tab/adopt', transfer: tab })
  }), [dispatch])

  const transferFor = useCallback((key: string): TabTransfer => {
    // Read when a drag ends, not when the callback is made: it goes to every pane, and one that
    // closed over the layout was a new function on every transition.
    const { layout, ptyOverrides, shellTabs, activeTerminal } = store.getState()
    const columns = layout.panes
    const ptyId = ptyOverrides.get(key) ?? null
    const shellKey = ptyId ?? key
    return {
      key,
      view: columns.flatMap((c) => c.tabs).find((t) => t.key === key)?.view ?? 'transcript',
      ptyId,
      shells: shellTabs.get(shellKey) ?? [],
      activeShell: activeTerminal.get(shellKey) ?? null,
    }
  }, [store])

  /** Another window took a tab this one was showing: what makes a cross-window drag a move. Opening
   *  the same session in two windows from the sidebar announces no claim. */
  useEffect(() => onTabClaimed((key) => {
    dispatch({ type: 'tab/closeEverywhere', key })
  }), [dispatch])

  useEffect(() => onSelectTab((key) => {
    dispatch({ type: 'tab/focus', key })
  }), [dispatch])

  return { transferFor }
}
