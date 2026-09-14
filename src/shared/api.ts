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

export interface AppSettingsPayload {
  claudeBin: string | null
  /** Import every discovered session automatically, instead of picking them by hand. */
  autoImportAll: boolean
  /** Minutes between automatic rescans, or null when periodic scanning is off. */
  autoImportIntervalMinutes: number | null
  /** Scroll the sidebar to a session, and highlight it, when its tab is activated. */
  revealActiveInSidebar: boolean
  /** Search conversation contents as well as titles. */
  searchChatContent: boolean
  /** Search the notes people write on sessions. */
  searchSessionNotes: boolean
  /** Trim the path in the prompt of shells Apiary starts. */
  terminalShortenPath: boolean
  /** How many trailing folders the trimmed prompt keeps. */
  terminalPathSegments: number
  /** Which session-bar plugins are on, by plugin id. */
  plugins: Record<string, boolean>
  /** Each plugin's own settings, namespaced by plugin id. */
  pluginSettings: Record<string, Record<string, string | number | boolean>>
  /** Check GitHub for a newer release on a schedule. */
  updateAutomaticChecks: boolean
  /** Hours between those checks. */
  updateCheckIntervalHours: number
  /** Fetch an update as soon as it is found, rather than after the user agrees to it. */
  updateAutoDownload: boolean
  /** Offer pre-release builds as well as stable ones. */
  updateAllowPrerelease: boolean
}

/** Mirrors `UpdateStatus` in main/update/updateService.ts; kept structural to avoid the renderer
 *  importing main-process code. */
export interface UpdateStatusPayload {
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'downloaded' | 'up-to-date' | 'error'
  capability: { kind: 'auto' | 'assisted' | 'unsupported'; reason: string }
  currentVersion: string
  availableVersion: string | null
  releaseNotes: string | null
  releaseUrl: string | null
  progressPercent: number | null
  downloadedPath: string | null
  error: string | null
  lastCheckedAt: number | null
  skippedVersion: string | null
}

/** A setting a plugin declares, which the Plugins section of Settings draws. */
export type PluginSettingFieldPayload =
  | { kind: 'string'; key: string; label: string; help?: string; placeholder?: string; default: string }
  | { kind: 'boolean'; key: string; label: string; help?: string; default: boolean }
  | { kind: 'number'; key: string; label: string; help?: string; default: number; min?: number; max?: number }

/** A plugin as Settings sees it: what it is, whether it is on, and what it can be configured with. */
export interface PluginInfoPayload {
  id: string
  name: string
  description: string | null
  enabled: boolean
  fields: PluginSettingFieldPayload[]
  values: Record<string, string | number | boolean>
}

/** A button a plugin has contributed to a session's bar. Mirrors main/plugins/types.ts. */
export interface PluginBarItemPayload {
  pluginId: string
  id: string
  icon: 'merge-request' | 'link' | 'plus' | 'alert'
  label: string
  title: string
  action: { kind: 'open-url'; url: string } | { kind: 'none' }
  tone?: 'normal' | 'suggest' | 'problem'
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
  searchRebuild: 'apiary:search-rebuild',
  searchStatus: 'apiary:search-status',
  saveImage: 'apiary:save-image',
  readImage: 'apiary:read-image',
  sendPrompt: 'apiary:send-prompt',
  updateStatus: 'apiary:update-status',
  updateCheck: 'apiary:update-check',
  updateDownload: 'apiary:update-download',
  updateInstall: 'apiary:update-install',
  updateOpenDownloaded: 'apiary:update-open-downloaded',
  updateSkip: 'apiary:update-skip',
  updateDismiss: 'apiary:update-dismiss',
  updateChanged: 'apiary:update-changed',
  pluginBarItems: 'apiary:plugin-bar-items',
  pluginBarRefresh: 'apiary:plugin-bar-refresh',
  pluginRunAction: 'apiary:plugin-run-action',
  pluginList: 'apiary:plugin-list',
  pluginsChanged: 'apiary:plugins-changed',
  setSessionNote: 'apiary:set-session-note',
  sessionNote: 'apiary:session-note',
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
  settingsGet(): Promise<AppSettingsPayload>
  settingsSet(settings: AppSettingsPayload): Promise<void>
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
  /** Wipes and rebuilds the conversation index; resolves when the pass has finished. */
  searchRebuild(): Promise<void>
  /** How many sessions and notes are currently indexed. */
  searchStatus(): Promise<{ indexed: number; notes: number }>
  /** Buttons the session-bar plugins contribute for this session. Answers from cache. */
  pluginBarItems(key: string, isPtyId: boolean): Promise<PluginBarItemPayload[]>
  /** Forces the plugins to look again, ignoring the cache. */
  pluginBarRefresh(key: string, isPtyId: boolean): Promise<PluginBarItemPayload[]>
  /** Performs a bar item's action — opening its URL, after the main process has checked it. */
  pluginRunAction(item: PluginBarItemPayload): Promise<void>
  /** The plugins that exist, with their declared settings, for the Settings list. */
  pluginList(): Promise<PluginInfoPayload[]>
  /** Fires when a background plugin lookup changed what the bar should show. */
  onPluginsChanged(cb: () => void): () => void
  /** Saves the user's note for a session; an empty string removes it. */
  setSessionNote(sessionId: string, note: string): Promise<void>
  /** The note currently saved for a session, or '' when there is none. */
  sessionNote(sessionId: string): Promise<string>
  /** Writes a pasted image to Apiary's own data directory; resolves to its absolute path. */
  saveImage(base64: string, mediaType: string): Promise<string>
  /** Reads one of those images back as a data URL, or null if it is gone or out of bounds. */
  readImage(path: string): Promise<{ dataUrl: string } | null>
  /** Types a composed prompt into a session's running `claude` process and submits it. */
  sendPrompt(ptyId: string, text: string): Promise<void>

  /** The updater's current state, for the banner and the Settings panel. */
  updateStatus(): Promise<UpdateStatusPayload>
  /** Checks now. `manual` checks report "up to date" and errors; scheduled ones stay quiet. */
  updateCheck(): Promise<UpdateStatusPayload>
  updateDownload(): Promise<UpdateStatusPayload>
  /** Restarts into a staged update. Only meaningful when the phase is `ready`. */
  updateInstall(): Promise<void>
  /** Opens an already-downloaded installer again (the assisted flow). */
  updateOpenDownloaded(): Promise<void>
  updateSkip(): Promise<void>
  updateDismiss(): Promise<void>
  /** Pushed whenever the updater's state changes, to every window. */
  onUpdateChanged(cb: (status: UpdateStatusPayload) => void): () => void
}

declare global {
  interface Window { apiary: ApiaryApi }
}
