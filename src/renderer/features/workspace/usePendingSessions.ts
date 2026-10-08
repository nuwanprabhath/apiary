import type { PtyId } from '@shared/domain/ids'
import { useCallback, useEffect } from 'react'
import type { NewSessionInfo, ProjectNode } from '@shared/types'
import { treeStore } from '../../state/treeStore'
import { fireAndForget } from '../../ui/fireAndForget'
import { useWorkspaceDispatch } from './workspaceContext'
import { renameTerminalTitle } from '../../state/terminals'
import { onNewSessionStarted } from '../../state/sessions'

/**
 * Registering a brand-new session's pty as pending: the entry points (`addPending`, which the
 * sidebar "+", the fork action and the worktree dialog call, and the File menu's push from main)
 * and the typed-in rename a pending tab holds until it has a session to apply it to. Resolving a
 * pending entry is `useSessionFollowing`'s job.
 */
export function usePendingSessions(): {
  addPending: (info: NewSessionInfo, nodes: ProjectNode[], opts?: { titleOverride?: string; after?: string }) => void
  setPendingTitle: (ptyId: PtyId, title: string) => void
} {
  const dispatch = useWorkspaceDispatch()

  // Registers a freshly-started new session as pending and opens it as a tab — shared by both
  // entry points (the sidebar "+" button and the File menu item below). The tab is keyed by pty
  // id until the watcher finds the session's real id, at which point the reconciler below rekeys
  // it in place.
  const addPending = useCallback((
    info: NewSessionInfo,
    nodes: ProjectNode[],
    // A fork arrives with both of these: a title it should keep once it has a session id to hang
    // it on, and the tab it belongs next to. A session started from scratch has neither.
    opts: { titleOverride?: string; after?: string } = {},
  ) => {
    dispatch({ type: 'pending/add', info, nodes, ...opts })
  }, [dispatch])

  // `File > New Session in Folder...` picks its folder via a native dialog in the main process
  // (never from the renderer) and pushes the result here once the pty is already running.
  useEffect(() => onNewSessionStarted((info) => {
    // UI-23: unlike the tree re-syncs below (which get another chance on the next treeChanged
    // event), this fires once per real session main already started — a failure here silently
    // drops the pending tab for a pty that is genuinely running, worth finding in the log.
    fireAndForget(treeStore.current().then((nodes) => { addPending(info, nodes) }), 'tabs')
  }), [addPending])

  // Records a rename typed in before this pending session had a real id yet — held in-memory
  // (see PendingSession.titleOverride) until the reconciliation effect above can apply it.
  const setPendingTitle = useCallback((ptyId: PtyId, title: string) => {
    // Also typed into that Claude as `/rename`. Beyond naming it where VS Code and /resume look,
    // this is what lets the tab resolve: a fork or new session writes no transcript until
    // something happens in it — measured on a real Haiku fork — so a renamed but untouched tab
    // otherwise waited, still `new:…`, however often Refresh was pressed. The rename makes Claude
    // write the transcript, the tab follows it, and the title below is applied as a real rename.
    if (title.trim() !== '') renameTerminalTitle(ptyId, title)
    dispatch({ type: 'pending/title', ptyId, title })
  }, [dispatch])

  return { addPending, setPendingTitle }
}
