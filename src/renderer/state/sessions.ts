import type { SessionId, TerminalRef } from '@shared/domain/ids'
import type { DiscoveredSession, NewSessionInfo, ResumeConflict } from '@shared/domain/session'
import { attempt, bestEffort, surface } from './policy'

/**
 * Commands on sessions (the tree itself is `treeStore`). Which error policy each follows is in
 * `policy.ts`: the ones that return a promise are awaited by a component that shows the failure
 * itself (a busy spinner, a toast naming what it was doing, an inline line); the rest are wrapped.
 */

export const startSessionInProject = (path: string): Promise<NewSessionInfo> => window.apiary.newSessionInProject(path)
/** Asks for a folder with the native picker; null when cancelled. */
export const startSessionInPickedFolder = (): Promise<NewSessionInfo | null> => window.apiary.newSessionInPickedFolder()
export const forkSession = (sessionId: SessionId): Promise<NewSessionInfo> => window.apiary.forkSession(sessionId)
export const resumeSession = (sessionId: SessionId): Promise<void> => window.apiary.resume(sessionId)
/** Where else the session already runs, or null. */
export const findResumeConflict = (sessionId: SessionId): Promise<ResumeConflict | null> => window.apiary.checkConflict(sessionId)
export const removeSession = (sessionId: SessionId): Promise<void> => window.apiary.removeSession(sessionId)
export const moveSession = (sessionId: SessionId, targetProjectPath: string): Promise<void> =>
  window.apiary.moveSession(sessionId, targetProjectPath)

/** Renames a session. The title is already on screen, so only a failure needs telling. */
export function renameSession(sessionId: SessionId, title: string): void {
  surface(window.apiary.renameSession(sessionId, title), 'Could not rename the session')
}

/** The saved note, or null when it could not be read (the caller falls back to the one it has). */
export const loadSessionNote = (sessionId: SessionId): Promise<string | null> =>
  bestEffort(window.apiary.sessionNote(sessionId), 'app')
export function saveSessionNote(sessionId: SessionId, note: string): void {
  surface(window.apiary.setSessionNote(sessionId, note), 'Could not save the note')
}

/** Re-scans Claude's projects folder; the caller reloads the tree and reports what it found. */
export const rescanSessions = (): Promise<void> => window.apiary.refresh()
export const listDiscoveredSessions = (): Promise<DiscoveredSession[]> => window.apiary.discovered()
export const importSessions = (sessionIds: SessionId[], autoImportProjects: string[]): Promise<void> =>
  window.apiary.importSessions(sessionIds, autoImportProjects)

/** Full-text search over what was said; the sidebar narrows to titles and paths when it fails. */
export const searchContent = (query: string): Promise<string[]> => window.apiary.searchContent(query)
/** How many sessions and notes are indexed; null when it could not be read. */
export const readSearchStatus = (): Promise<{ indexed: number; notes: number } | null> =>
  bestEffort(window.apiary.searchStatus(), 'search')
/** Rebuilds the search index; whether it worked (a failure was shown, the old index stays). */
export const rebuildSearchIndex = (): Promise<boolean> =>
  attempt(window.apiary.searchRebuild(), 'Could not rebuild the search index')

/** Whether the VS Code CLI is there. Never rejects: not knowing is "no". */
export const isVsCodeAvailable = (): Promise<boolean> =>
  bestEffort(window.apiary.vsCodeAvailable(), 'vscode').then((v) => v === true)
export function openSessionInVsCode(sessionId: SessionId): void {
  const terminal: TerminalRef = { kind: 'session', id: sessionId }
  surface(window.apiary.openInVsCode(terminal), 'Could not open VS Code')
}

/** Opens a file named in a session's transcript, as written; main resolves and confines it. */
export function openMentionedFile(sessionId: SessionId, mention: string): void {
  surface(window.apiary.openMentionedFile({ kind: 'session', id: sessionId }, mention), 'Could not open that file')
}

/** A session main started on its own (File → New Session in Folder…), pty already running. */
export const onNewSessionStarted = (cb: (info: NewSessionInfo) => void): (() => void) =>
  window.apiary.onNewSessionStarted(cb)
/** File → Import Sessions… */
export const onOpenImportDialog = (cb: () => void): (() => void) => window.apiary.onOpenImportDialog(cb)
