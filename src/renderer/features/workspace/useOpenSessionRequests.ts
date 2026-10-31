import { useCallback, useEffect } from 'react'
import type { SessionId } from '@shared/domain/ids'
import { findSessionById } from '@shared/treeWalk'
import { currentActiveTabs } from '../../state/activeTabsStore'
import { findColumnWithTab } from '../../state/columns'
import { background } from '../../state/policy'
import { focusTabInWindow, onOpenSessionRequested } from '../../state/tabs'
import { treeStore } from '../../state/treeStore'
import { windowNumber } from '../../state/windowParams'
import { useWorkspaceDispatch, useWorkspaceStore } from './workspaceContext'

/**
 * Shows a session the way a resident asks to: a tab already open anywhere is focused where it is
 * (here through `session/open`, in another window through the Active section's `focusTab`);
 * otherwise the session opens in this window's focused pane through `session/open`, the action a
 * click on a sidebar row dispatches. The resident popup's chips and match cards call it too.
 */
export function useOpenSession(): (sessionId: SessionId) => void {
  const dispatch = useWorkspaceDispatch()
  const store = useWorkspaceStore()
  return useCallback((sessionId: SessionId) => {
    background((async () => {
      if (findColumnWithTab(store.getState().layout.panes, sessionId) === null) {
        const elsewhere = (await currentActiveTabs()).find((t) => t.key === sessionId && t.windowNumber !== windowNumber())
        if (elsewhere !== undefined) {
          focusTabInWindow(elsewhere.windowNumber, sessionId)
          return
        }
      }
      const session = treeStore.findSessionById(sessionId) ?? findSessionById(await treeStore.current(), sessionId)
      if (session !== null) dispatch({ type: 'session/open', session, split: false })
    })(), 'residents')
  }, [dispatch, store])
}

/** A resident asked to show a session (main sends it to the window in front). */
export function useOpenSessionRequests(): void {
  const open = useOpenSession()
  useEffect(() => onOpenSessionRequested(open), [open])
}
