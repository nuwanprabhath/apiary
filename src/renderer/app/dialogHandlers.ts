import type { SessionId } from '@shared/domain/ids'
import type { NewSessionInfo, SessionNode } from '@shared/types'

/** What the window's dialogs call back with: each a plain handler over the async command behind it. */
export function dialogHandlers(deps: {
  forkSession: (sessionId: SessionId) => Promise<unknown>
  startResume: (session: SessionNode) => Promise<unknown>
  confirmDelete: (session: SessionNode) => Promise<unknown>
  onWorktreeCreated: (info: NewSessionInfo, folder: string) => Promise<unknown>
  onFolderSessionStarted: (info: NewSessionInfo) => Promise<unknown>
}): {
  onFork: (sessionId: SessionId) => void
  onOpenAnyway: (session: SessionNode) => void
  onConfirmDelete: (session: SessionNode) => void
  onWorktreeCreated: (info: NewSessionInfo, folder: string) => void
  onSessionStarted: (info: NewSessionInfo) => void
} {
  const { forkSession, startResume, confirmDelete, onWorktreeCreated, onFolderSessionStarted } = deps
  return {
    onFork: (id) => { void forkSession(id) },
    onOpenAnyway: (session) => { void startResume(session) },
    onConfirmDelete: (session) => { void confirmDelete(session) },
    onWorktreeCreated: (info, folder) => { void onWorktreeCreated(info, folder) },
    onSessionStarted: (info) => { void onFolderSessionStarted(info) },
  }
}
