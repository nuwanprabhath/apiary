import { type Dispatch, useCallback } from 'react'
import type { SessionId } from '@shared/domain/ids'
import type { TabTransfer } from '@shared/domain/tabs'
import type { SessionNode } from '@shared/types'
import { sessionIdOfTabKey } from '../features/workspace'
import type { WorkspaceAction } from '../features/workspace/workspaceReducer'
import type { useWorkspaceStore } from '../features/workspace/workspaceContext'
import { renameSession } from '../state/sessions'
import { detachTab, dropTab } from '../state/tabs'

interface TabKeyDeps {
  dispatch: Dispatch<WorkspaceAction>
  store: ReturnType<typeof useWorkspaceStore>
  togglePin: (session: SessionNode) => void
  forkSession: (sessionId: SessionId) => Promise<unknown>
  transferFor: (key: string) => TabTransfer
  onResume: (session: SessionNode) => Promise<unknown>
}

/**
 * The handlers a pane's tabs call with a tab key, each stable for `SessionColumn`'s `React.memo`
 * (tests/component/appPropStability.test.tsx). The ones that need the current open sessions read
 * the workspace store when they run, not a render's closure.
 */
export function useTabKeyHandlers(deps: TabKeyDeps): {
  onResumeClick: (session: SessionNode) => void
  onRenameSession: (session: SessionNode, title: string) => void
  onTogglePinKey: (key: string) => void
  onForkKey: (key: string) => void
  onTabDropped: (key: string, at: { x: number; y: number }) => void
  onDetach: (key: string, at: { x: number; y: number }) => void
} {
  const { dispatch, store, togglePin, forkSession, transferFor, onResume } = deps
  const onResumeClick = useCallback((session: SessionNode) => { void onResume(session) }, [onResume])
  const onRenameSession = useCallback((session: SessionNode, title: string) => {
    dispatch({ type: 'openSessions/set', session: { ...session, title } })
    renameSession(session.sessionId, title)
  }, [dispatch])
  const onTogglePinKey = useCallback((key: string) => {
    // A pending tab has no session row to pin yet, so this simply does nothing for it rather than
    // pinning an id that will be replaced the moment it resolves.
    const session = store.getState().openSessions.get(key)
    if (session) togglePin(session)
  }, [store, togglePin])
  const onForkKey = useCallback((key: string) => { void forkSession(sessionIdOfTabKey(key)) }, [forkSession])
  const onTabDropped = useCallback((key: string, at: { x: number; y: number }) => { dropTab(transferFor(key), at) }, [transferFor])
  const onDetach = useCallback((key: string, at: { x: number; y: number }) => { detachTab(transferFor(key), at) }, [transferFor])
  return { onResumeClick, onRenameSession, onTogglePinKey, onForkKey, onTabDropped, onDetach }
}
