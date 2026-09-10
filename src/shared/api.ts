import type {
  ProjectNode,
  ResumeConflict,
  TranscriptPage,
  NewSessionInfo,
  GitStatus,
  GitRefs,
} from './types'

export interface DiscoveredSession {
  sessionId: string
  projectPath: string
  title: string
  lastActiveAtMs: number | null
  imported: boolean
}

export const CHANNELS = {
  refresh: 'apiary:refresh',
  tree: 'apiary:tree',
  discovered: 'apiary:discovered',
  importSessions: 'apiary:import',
  transcript: 'apiary:transcript',
  checkConflict: 'apiary:check-conflict',
  resume: 'apiary:resume',
  renameSession: 'apiary:rename-session',
  removeSession: 'apiary:remove-session',
  openShell: 'apiary:open-shell',
  openShellForPty: 'apiary:open-shell-for-pty',
  newSessionInProject: 'apiary:new-session-in-project',
  newSessionStarted: 'apiary:new-session-started',
  ptyWrite: 'apiary:pty-write',
  ptyResize: 'apiary:pty-resize',
  ptyKill: 'apiary:pty-kill',
  ptyData: 'apiary:pty-data',
  ptyExit: 'apiary:pty-exit',
  treeChanged: 'apiary:tree-changed',
  openImportDialog: 'apiary:open-import-dialog',
  settingsGet: 'apiary:settings-get',
  settingsSet: 'apiary:settings-set',
  openSettingsDialog: 'apiary:open-settings-dialog',
  gitStatus: 'apiary:git-status',
  gitListRefs: 'apiary:git-list-refs',
  gitCheckoutBranch: 'apiary:git-checkout-branch',
  gitCheckoutRemote: 'apiary:git-checkout-remote',
  gitCheckoutDetached: 'apiary:git-checkout-detached',
  gitCreateBranch: 'apiary:git-create-branch',
  gitPull: 'apiary:git-pull',
  gitPush: 'apiary:git-push',
  gitMerge: 'apiary:git-merge',
  gitFetch: 'apiary:git-fetch',
  copyToClipboard: 'apiary:copy-to-clipboard',
} as const

export interface ApiaryApi {
  refresh(): Promise<void>
  tree(query?: string): Promise<ProjectNode[]>
  discovered(): Promise<DiscoveredSession[]>
  importSessions(sessionIds: string[], autoImportProjects: string[]): Promise<void>
  transcript(sessionId: string, beforeIndex?: number): Promise<TranscriptPage>
  checkConflict(sessionId: string): Promise<ResumeConflict | null>
  resume(sessionId: string, fork: boolean): Promise<void>
  /** Sets (empty/whitespace-only clears) a session's user-facing title. */
  renameSession(sessionId: string, title: string): Promise<void>
  /** Removes a session from view (never touches the JSONL on disk). Rejects while it is live. */
  removeSession(sessionId: string): Promise<void>
  openShell(sessionId: string, tabId: string): Promise<void>
  /** Same as `openShell`, but for a new session's pty before it has a real session id yet. */
  openShellForPty(ptyId: string, tabId: string): Promise<void>
  /**
   * Starts a brand-new session in a project the store already knows about. `path` is the
   * project's stable identity (`ProjectNode.path`) — the main process validates it against a
   * stored project row before spawning, never trusting it as a raw filesystem path.
   */
  newSessionInProject(path: string): Promise<NewSessionInfo>
  /** Fired when `File > New Session in Folder...` starts a session via the native dialog. */
  onNewSessionStarted(cb: (info: NewSessionInfo) => void): () => void
  ptyWrite(id: string, data: string): void
  ptyResize(id: string, cols: number, rows: number): void
  ptyKill(id: string): void
  onPtyData(cb: (id: string, data: string) => void): () => void
  onPtyExit(cb: (id: string, exitCode: number) => void): () => void
  onTreeChanged(cb: () => void): () => void
  onOpenImportDialog(cb: () => void): () => void
  settingsGet(): Promise<{ claudeBin: string | null }>
  settingsSet(settings: { claudeBin: string | null }): Promise<void>
  onOpenSettingsDialog(cb: () => void): () => void
  gitStatus(key: string, isPtyId: boolean): Promise<GitStatus>
  gitListRefs(key: string, isPtyId: boolean): Promise<GitRefs>
  gitCheckoutBranch(key: string, isPtyId: boolean, name: string): Promise<void>
  gitCheckoutRemote(key: string, isPtyId: boolean, remoteRef: string, localName: string): Promise<void>
  gitCheckoutDetached(key: string, isPtyId: boolean, ref: string): Promise<void>
  gitCreateBranch(key: string, isPtyId: boolean, name: string, from?: string): Promise<void>
  gitPull(key: string, isPtyId: boolean): Promise<void>
  gitPush(key: string, isPtyId: boolean): Promise<void>
  gitMerge(key: string, isPtyId: boolean, ref: string): Promise<void>
  gitFetch(key: string, isPtyId: boolean): Promise<void>
  copyToClipboard(text: string): Promise<void>
}

declare global {
  interface Window { apiary: ApiaryApi }
}
