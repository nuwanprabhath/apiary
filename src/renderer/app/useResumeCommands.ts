import { type Dispatch, useCallback } from 'react'
import type { SessionNode } from '@shared/types'
import type { DialogRequest } from '../features/dialogs/useDialogs'
import type { WorkspaceAction } from '../features/workspace/workspaceReducer'
import { useWorkspaceStore } from '../features/workspace/workspaceContext'
import { findResumeConflict, removeSession, resumeSession } from '../state/sessions'
import type { useNotifications } from '../ui/notifications'

interface Deps {
  dispatch: Dispatch<WorkspaceAction>
  notifyError: ReturnType<typeof useNotifications>['notifyError']
  openDialog: (request: DialogRequest) => void
  unpin: (sessionId: string) => void
}

/**
 * Resuming and deleting a session (`confirmDelete` is the delete half: both go through the one
 * workspace-store read below, so they live together). Handlers every pane receives read the workspace through the
 * store when they run, not through a render's closure: one that closed over `resumed` got a new
 * identity on every change to it and re-rendered every pane (review §7.2).
 */
export function useResumeCommands({ dispatch, notifyError, openDialog, unpin }: Deps) {
  const store = useWorkspaceStore()

  const startResume = useCallback(async (session: SessionNode) => {
    try {
      await resumeSession(session.sessionId)
      dispatch({ type: 'resumed/add', key: session.sessionId })
      dispatch({ type: 'tab/showView', key: session.sessionId, view: 'terminal' })
    } catch (e) {
      notifyError(e, 'Could not resume this session')
    }
  }, [notifyError, dispatch])

  const confirmDelete = useCallback(async (target: SessionNode) => {
    try {
      await removeSession(target.sessionId)
      // A session that is no longer in the tree has nothing left to show, so close every tab
      // pointing at it rather than leaving a stale header behind in some column.
      dispatch({ type: 'session/removed', sessionId: target.sessionId })
      unpin(target.sessionId)
    } catch (e) {
      notifyError(e, 'Could not remove this session')
    }
  }, [notifyError, unpin, dispatch])

  const onResume = useCallback(async (session: SessionNode) => {
    if (store.getState().resumed.has(session.sessionId)) {
      dispatch({ type: 'tab/showView', key: session.sessionId, view: 'terminal' })
      return
    }
    try {
      const existing = await findResumeConflict(session.sessionId)
      if (existing !== null) { openDialog({ kind: 'conflict', session, conflict: existing }); return }
      await startResume(session)
    } catch (e) {
      // User-initiated (UI-23): clicking a session is the one reason this runs, so a failure here
      // — main's own callers (`onResumeClick`) `void` this — is worth naming, not the generic
      // "Unexpected error" the window-level net would otherwise print.
      notifyError(e, 'Could not resume this session')
    }
  }, [store, startResume, dispatch, notifyError, openDialog])

  /**
   * Resume for the composer: resolves only once there is a process to type into.
   *
   * Distinct from `onResume` above, which is free to hand off to the conflict dialog and return
   * having started nothing. A composer that sent as soon as *that* resolved would be typing into a
   * session the user has not yet agreed to open. Here a conflict is a refusal, stated as one.
   */
  const resumeAndWait = useCallback(async (session: SessionNode) => {
    if (store.getState().resumed.has(session.sessionId)) return
    const existing = await findResumeConflict(session.sessionId)
    if (existing !== null) {
      openDialog({ kind: 'conflict', session, conflict: existing })
      throw new Error('This session is already running elsewhere — choose how to open it first.')
    }
    await resumeSession(session.sessionId)
    dispatch({ type: 'resumed/add', key: session.sessionId })
    dispatch({ type: 'tab/showView', key: session.sessionId, view: 'terminal' })
  }, [store, dispatch, openDialog])

  return { startResume, confirmDelete, onResume, resumeAndWait }
}
