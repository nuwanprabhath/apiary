import type { PtyId } from '@shared/domain/ids'
import { useCallback, useEffect } from 'react'
import type { NewSessionInfo, ProjectNode } from '@shared/types'
import { treeStore } from '../../state/treeStore'
import { fireAndForget } from '../../ui/fireAndForget'
import { useWorkspaceDispatch } from './workspaceContext'
import { renameTerminalTitle } from '../../state/terminals'
import { onNewSessionStarted } from '../../state/sessions'

/** Resolving a pending entry is `useSessionFollowing`'s job. */
export function usePendingSessions(): {
  addPending: (info: NewSessionInfo, nodes: ProjectNode[], opts?: { titleOverride?: string; after?: string }) => void
  setPendingTitle: (ptyId: PtyId, title: string) => void
} {
  const dispatch = useWorkspaceDispatch()

  const addPending = useCallback((
    info: NewSessionInfo,
    nodes: ProjectNode[],
    // A fork arrives with a title to keep and the tab it belongs next to; a fresh session has neither.
    opts: { titleOverride?: string; after?: string } = {},
  ) => {
    dispatch({ type: 'pending/add', info, nodes, ...opts })
  }, [dispatch])

  // `File > New Session in Folder...` picks its folder in main (never the renderer) and pushes the
  // result here once the pty is running.
  useEffect(() => onNewSessionStarted((info) => {
    // Fires once per session main already started, with no retry on the next treeChanged, so a
    // failure drops the tab of a running pty: worth finding in the log.
    fireAndForget(treeStore.current().then((nodes) => { addPending(info, nodes) }), 'tabs')
  }), [addPending])

  // The rename is held in memory (PendingSession.titleOverride) until a real id exists.
  const setPendingTitle = useCallback((ptyId: PtyId, title: string) => {
    // Also typed into that Claude as `/rename`: a fork or new session writes no transcript until
    // something happens in it (measured on a real Haiku fork), so an untouched tab would stay
    // `new:…`. The rename makes Claude write it, the tab follows, and the title is applied.
    if (title.trim() !== '') renameTerminalTitle(ptyId, title)
    dispatch({ type: 'pending/title', ptyId, title })
  }, [dispatch])

  return { addPending, setPendingTitle }
}
