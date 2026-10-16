import { useCallback } from 'react'
import type { SessionId } from '@shared/domain/ids'
import type { NewSessionInfo } from '@shared/types'
import type { usePendingSessions } from '../features/workspace/usePendingSessions'
import { remoteHost } from '../state/windowParams'
import { treeStore } from '../state/treeStore'
import { forkSession as forkSessionCommand, startSessionInPickedFolder, startSessionInProject } from '../state/sessions'
import type { useNotifications } from '../ui/notifications'

type Notifications = ReturnType<typeof useNotifications>

interface Deps {
  addPending: ReturnType<typeof usePendingSessions>['addPending']
  notify: Notifications['notify']
  notifyError: Notifications['notifyError']
  requestFolder: () => Promise<NewSessionInfo | null>
  rememberCreatedWorktree: (folder: string, cwd: string) => void
}

/**
 * Every way a brand-new session (a fresh one, a fork, one in a picked folder or a new worktree)
 * becomes a pending tab. Each reloads the tree first so `addPending` can tell the new session from
 * the ones that already existed.
 */
export function useSessionStarters({ addPending, notify, notifyError, requestFolder, rememberCreatedWorktree }: Deps) {
  const onNewSession = useCallback(async (path: string) => {
    try {
      const [info, nodes] = await Promise.all([
        startSessionInProject(path),
        treeStore.reloadNow(),
      ])
      addPending(info, nodes)
    } catch (e) {
      notifyError(e, 'Could not start a new session')
    }
  }, [addPending, notifyError])

  // The fork has no session id until Claude writes the JSONL, so it goes through the pending
  // bookkeeping; `titleOverride` is applied as a rename on resolve, so the fork and its original
  // are never two rows with the same name.
  const forkSession = useCallback(async (sessionId: SessionId) => {
    try {
      const [info, nodes] = await Promise.all([
        forkSessionCommand(sessionId),
        treeStore.reloadNow(),
      ])
      addPending(info, nodes, { titleOverride: info.label, after: sessionId })
      notify({ message: `Forking — ${info.label}` })
    } catch (e) {
      notifyError(e, 'Could not fork this session')
    }
  }, [addPending, notify, notifyError])

  /** Resolves the new session's folder, so the sidebar can file it into the group it came from. */
  const onNewSessionInPickedFolder = useCallback(async (): Promise<string | null> => {
    try {
      // The native picker would open on the work machine's screen, so a remote window browses it in-app.
      const info = await (remoteHost() === null ? startSessionInPickedFolder() : requestFolder())
      if (info === null) return null
      addPending(info, await treeStore.reloadNow())
      return info.cwd
    } catch (e) {
      notifyError(e, 'Could not start a new session')
      return null
    }
  }, [addPending, notifyError, requestFolder])

  const onWorktreeCreated = useCallback(async (info: NewSessionInfo, folder: string) => {
    rememberCreatedWorktree(folder, info.cwd)
    notify({ message: `Worktree created at ${info.cwd} — starting Claude there` })
    try {
      addPending(info, await treeStore.reloadNow())
    } catch (e) {
      notifyError(e, 'Could not open the new worktree\'s session')
    }
  }, [addPending, notify, notifyError, rememberCreatedWorktree])

  const onFolderSessionStarted = useCallback(async (info: NewSessionInfo) => {
    try {
      addPending(info, await treeStore.reloadNow())
    } catch (e) {
      notifyError(e, 'Could not open the new session')
    }
  }, [addPending, notifyError])

  const onSessionStarted = useCallback((info: NewSessionInfo) => {
    void treeStore.current().then((nodes) => { addPending(info, nodes) })
      .catch((e: unknown) => { notifyError(e, 'Could not open that session') })
  }, [addPending, notifyError])

  return {
    onNewSession, forkSession, onNewSessionInPickedFolder, onWorktreeCreated, onFolderSessionStarted,
    onSessionStarted,
  }
}
