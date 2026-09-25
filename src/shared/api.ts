import type {
  CheckoutOutcome,
  ProjectNode,
  ResumeConflict,
  TranscriptPage,
  NewSessionInfo,
  GitStatus,
  GitRefs,
  TabTransfer,
  WindowLayoutReport,
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
  /** Whether the Recent section (sessions active in the last `recentSectionHours`) is shown. */
  recentSectionEnabled: boolean
  /** How far back "recent" looks, in hours. */
  recentSectionHours: number
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
  /** Write a diagnostic log to disk. Off by default; off means nothing is written at all. */
  diagnosticsEnabled: boolean
  /** How long archived log files are kept. */
  logRetentionDays: number
  /** Total disk the logs may take, across every file. */
  logMaxSizeMb: number
}

/** Where the diagnostic logs are and how much room they take, for the Diagnostics section. */
export interface LogStatusPayload {
  enabled: boolean
  dir: string
  files: number
  bytes: number
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
  /** What to do with the downloaded file, decided by the platform it landed on. */
  install: { hint: string; command: string | null; action: 'open' | 'reveal' } | null
  /** What the last attempt to open/reveal the installer actually did. Null until one has run. */
  openResult: { ok: 'opened' } | { ok: 'revealed' } | { ok: 'failed'; reason: string } | null
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

/** A tab open somewhere, with the activity `classifyActivity` derived for it, for the sidebar's
 *  Active section. Mirrors `OpenTab` (`main/tabRegistry.ts`) plus its computed status. */
/** A theme the user saved (see main/theme/themeStore.ts). Its spec has been validated. */
export interface SavedTheme {
  id: string
  name: string
  /** What it was generated from, when it was generated; null for a copy of another theme. */
  prompt: string | null
  createdAt: number
  spec: import('./theme/spec').ThemeSpec
}

export interface ThemeOptions {
  /** Whether effects move. Off draws a still frame — as does the OS asking for reduced motion. */
  animated: boolean
  /** A multiplier on every effect's intensity, 0–1. */
  intensity: number
  /** Which Claude model designs themes: 'sonnet', 'haiku' or 'opus'. */
  model: string
}

/** A theme Claude designed, validated in main; `note` says what validation changed, if anything. */
export interface ThemeGenerateResult {
  spec: import('./theme/spec').ThemeSpec
  note: string | null
}

/** Everything the Themes screen and every window's styling need, pushed on every change. */
export interface ThemeState {
  /** A saved theme's id, a `builtin:*` id, or null for Apiary's own look. */
  activeId: string | null
  /** What to apply: the active theme's spec — or null for the original look, including in safe mode. */
  active: import('./theme/spec').ThemeSpec | null
  saved: SavedTheme[]
  builtins: Array<{ id: string; spec: import('./theme/spec').ThemeSpec }>
  options: ThemeOptions
  /** Started with `--safe-theme`: the original look for this run, whatever is saved. */
  safeMode: boolean
}

export interface ActiveTabPayload {
  windowNumber: number
  key: string
  view: 'transcript' | 'terminal'
  status: import('./activity').ActivityStatus
  /** The tab's title while it has no session yet (see `reportTabs`); null otherwise. */
  label: string | null
}

/** A button a plugin has contributed to a session's bar. Mirrors main/plugins/types.ts. */
export interface PluginBarItemPayload {
  pluginId: string
  id: string
  icon: 'merge-request' | 'merge-request-merged' | 'merge-request-closed' | 'link' | 'plus' | 'alert'
  label: string
  title: string
  action: { kind: 'open-url'; url: string } | { kind: 'none' }
  tone?: 'normal' | 'suggest' | 'problem'
}

export const CHANNELS = {
  refresh: 'apiary:refresh',
  tree: 'apiary:tree',
  searchContent: 'apiary:search-content',
  discovered: 'apiary:discovered',
  importSessions: 'apiary:import',
  transcript: 'apiary:transcript',
  checkConflict: 'apiary:check-conflict',
  resume: 'apiary:resume',
  renameSession: 'apiary:rename-session',
  themeInitial: 'apiary:theme-initial',
  themeState: 'apiary:theme-state',
  themeApply: 'apiary:theme-apply',
  themeSave: 'apiary:theme-save',
  themeRename: 'apiary:theme-rename',
  themeDelete: 'apiary:theme-delete',
  themeSetOptions: 'apiary:theme-set-options',
  themeChanged: 'apiary:theme-changed',
  themeGenerate: 'apiary:theme-generate',
  themeGenerateCancel: 'apiary:theme-generate-cancel',
  renameTerminalInClaude: 'apiary:rename-terminal-in-claude',
  removeSession: 'apiary:remove-session',
  moveSession: 'apiary:move-session',
  openShell: 'apiary:open-shell',
  openShellForPty: 'apiary:open-shell-for-pty',
  newSessionInProject: 'apiary:new-session-in-project',
  forkSession: 'apiary:fork-session',
  newSessionStarted: 'apiary:new-session-started',
  ptyWrite: 'apiary:pty-write',
  ptyResize: 'apiary:pty-resize',
  ptyKill: 'apiary:pty-kill',
  ptyData: 'apiary:pty-data',
  ptySnapshot: 'apiary:pty-snapshot',
  ptySessions: 'apiary:pty-sessions',
  mrStatusesInvalidated: 'apiary:mr-statuses-invalidated',
  ptySessionsChanged: 'apiary:pty-sessions-changed',
  ptyRunning: 'apiary:pty-running',
  ptyExit: 'apiary:pty-exit',
  treeChanged: 'apiary:tree-changed',
  openImportDialog: 'apiary:open-import-dialog',
  settingsGet: 'apiary:settings-get',
  settingsSet: 'apiary:settings-set',
  openSettingsDialog: 'apiary:open-settings-dialog',
  toggleSidebar: 'apiary:toggle-sidebar',
  gitStatus: 'apiary:git-status',
  gitListRefs: 'apiary:git-list-refs',
  gitlabMrRefStatus: 'apiary:gitlab-mr-ref-status',
  gitCheckoutBranch: 'apiary:git-checkout-branch',
  gitPullWorktree: 'apiary:git-pull-worktree',
  newSessionInWorktree: 'apiary:new-session-in-worktree',
  gitCheckoutRemote: 'apiary:git-checkout-remote',
  gitCheckoutDetached: 'apiary:git-checkout-detached',
  gitCreateBranch: 'apiary:git-create-branch',
  gitPull: 'apiary:git-pull',
  gitPullFolder: 'apiary:git-pull-folder',
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
  logStatus: 'apiary:log-status',
  logReveal: 'apiary:log-reveal',
  logClear: 'apiary:log-clear',
  logWrite: 'apiary:log-write',
  tabDropped: 'apiary:tab-dropped',
  tabDetach: 'apiary:tab-detach',
  tabAdoptHere: 'apiary:tab-adopt-here',
  tabAdopt: 'apiary:tab-adopt',
  tabClaimed: 'apiary:tab-claimed',
  reportLayout: 'apiary:report-layout',
  requestLayoutFlush: 'apiary:request-layout-flush',
  reportTabs: 'apiary:report-tabs',
  activeTabs: 'apiary:active-tabs',
  activeTabsChanged: 'apiary:active-tabs-changed',
  focusTab: 'apiary:focus-tab',
  selectTab: 'apiary:select-tab',
  vsCodeAvailable: 'apiary:vscode-available',
  openInVsCode: 'apiary:open-in-vscode',
} as const


/**
 * Which Claude session a running terminal is on right now, from Claude's own
 * `~/.claude/sessions/<pid>.json` — see `claudeSessionTracker.ts` in main.
 */
export interface PtySessionInfo {
  sessionId: string
  /** Claude's name for the session, or null when it has none. */
  name: string | null
  /** True when the user chose the name (`/rename`, `--name`) rather than Claude deriving one. */
  nameIsUser: boolean
  status: 'idle' | 'busy' | null
}

/** A pty's screen as escape sequences that repaint it, and the size they were laid out for. */
export interface PtySnapshot {
  data: string
  cols: number
  rows: number
}

export interface ApiaryApi {
  refresh(): Promise<void>
  tree(): Promise<ProjectNode[]>
  /** Session ids matched by conversation content or notes — only worth calling when either search
   *  setting is on; empty when both are off. */
  searchContent(query: string): Promise<string[]>
  discovered(): Promise<DiscoveredSession[]>
  importSessions(sessionIds: string[], autoImportProjects: string[]): Promise<void>
  transcript(sessionId: string, beforeIndex?: number): Promise<TranscriptPage>
  checkConflict(sessionId: string): Promise<ResumeConflict | null>
  /**
   * Opens a session in an embedded terminal, keyed by its own id.
   *
   * Forking is `forkSession`, not a flag here. It used to be one, and that was wrong in a way
   * worth recording: `--fork-session` makes Claude write a *different* session, so the pty ended
   * up keyed by the id of a conversation it was not running. The original's transcript never
   * moved, the fork appeared later as a row with no terminal, and pressing Resume on it started a
   * second process. A fork has no id until Claude mints one, which is a different shape of
   * operation entirely.
   */
  resume(sessionId: string): Promise<void>
  /** Reports this window's current bounds, panes and tabs so it can be restored on next launch. */
  reportLayout(report: WindowLayoutReport): Promise<void>
  /** Tells main what this window currently has open, replacing its previous report. Sent from the
   *  same effect as `reportLayout`, over the same walk of this window's tabs — see App.tsx. */
  reportTabs(tabs: { key: string; view: 'transcript' | 'terminal'; ptyId: string | null; label: string | null }[]): void
  /** Every open tab across every window, with its derived status, for the Active section. */
  activeTabs(): Promise<ActiveTabPayload[]>
  /** Fires whenever the registry or any tab's activity status changes. */
  onActiveTabsChanged(cb: () => void): () => void
  /** Raises the given window and selects that tab in it. */
  focusTab(windowNumber: number, key: string): Promise<void>
  /** Fired in the target window so it can switch to the tab `focusTab` asked for. */
  onSelectTab(cb: (key: string) => void): () => void
  /** Sets (empty/whitespace-only clears) a session's user-facing title. */
  renameSession(sessionId: string, title: string): Promise<void>
  /** The theme state as it stood when this window loaded — read synchronously, so the first paint
   *  is already themed. */
  initialTheme: ThemeState
  themeState(): Promise<ThemeState>
  /** Makes a theme active: a saved id, a `builtin:*` id, or null for the original look. */
  themeApply(id: string | null): Promise<void>
  /** Saves `spec` under `name`. Main validates it; the renderer's copy is never trusted. */
  themeSave(name: string, spec: unknown, prompt?: string): Promise<SavedTheme>
  /** Has the user's `claude` design a theme from `request` — or adjust `current` as `request` asks. */
  themeGenerate(request: string, current: import('./theme/spec').ThemeSpec | null): Promise<ThemeGenerateResult>
  themeGenerateCancel(): void
  themeRename(id: string, name: string): Promise<void>
  themeDelete(id: string): Promise<void>
  themeSetOptions(options: Partial<ThemeOptions>): Promise<void>
  onThemeChanged(cb: (state: ThemeState) => void): () => void
  /** Types `/rename <title>` into the Claude running in `ptyId`, once it is safe to (see
   *  claudeRename.ts) — for a tab with no session id yet, which `renameSession` cannot name. */
  renameTerminalInClaude(ptyId: string, title: string): void
  /** Removes a session from view (never touches the JSONL on disk). Rejects while it is live. */
  removeSession(sessionId: string): Promise<void>
  /** Moves a session's transcript to another worktree. Rejects while it is live, if the target
   *  file already exists, or if `targetProjectPath` is not a project the store already knows. */
  moveSession(sessionId: string, targetProjectPath: string): Promise<void>
  openShell(sessionId: string, tabId: string): Promise<void>
  /** Same as `openShell`, but for a new session's pty before it has a real session id yet. */
  openShellForPty(ptyId: string, tabId: string): Promise<void>
  /**
   * Starts a brand-new session in a project the store already knows about. `path` is the
   * project's stable identity (`ProjectNode.path`) — the main process validates it against a
   * stored project row before spawning, never trusting it as a raw filesystem path.
   */
  newSessionInProject(path: string): Promise<NewSessionInfo>
  /**
   * Forks a session: starts a new one seeded with this one's conversation, leaving the original
   * alone. Resolves with the pending pty, the way starting a session does — a fork has no session
   * id of its own until Claude writes one.
   */
  forkSession(sessionId: string): Promise<NewSessionInfo>

  /**
   * A tab drag that ended without anything in this window taking it, at `at` in screen coordinates.
   *
   * The main process decides what that meant, from where the pointer was released: another window
   * of ours (move it there), no window at all (tear it off into a new one), or this same window
   * (nothing happened — the tab was released over the transcript or the sidebar).
   *
   * It has to be decided from geometry rather than from a drop event, because there is no drop
   * event to decide it from: an HTML5 drag started in one `BrowserWindow` delivers no `dragover`
   * or `drop` to another, so the receiving window never hears about the gesture at all. `dragend`
   * in the *source* window is the only part of a cross-window drag that reaches any of our code.
   */
  /** Where the diagnostic logs are, how many there are, and how much disk they take. */
  logStatus(): Promise<LogStatusPayload>
  /** Opens the log folder in the OS file manager. Resolves with the folder's path. */
  logReveal(): Promise<string>
  /** Deletes every log file. */
  logClear(): Promise<LogStatusPayload>
  /** Records something the renderer saw. A no-op when diagnostics are off. */
  logWrite(level: 'debug' | 'info' | 'warn' | 'error', scope: string, message: string, fields?: Record<string, unknown>): void

  tabDropped(tab: TabTransfer, at: { x: number; y: number }): Promise<void>
  /** Opens the tab in a window of its own, at `at`, and takes it out of every other window. */
  tabDetach(tab: TabTransfer, at: { x: number; y: number }): Promise<void>
  /**
   * A tab from another window was dropped on this window's own tab strip. Where the platform
   * delivers drag events across windows (X11 can), the drop lands here rather than as a `dragend`
   * over nothing in the window it came from — so this window asks to take it, and every other
   * window lets go, exactly as `tabDropped` would have arranged.
   */
  tabAdoptHere(tab: TabTransfer): Promise<void>
  /** Fired when a tab dragged from another window has been dropped on this one. */
  onTabAdopt(cb: (tab: TabTransfer) => void): () => void
  /** Fired when another window has taken a tab this one was showing. */
  onTabClaimed(cb: (key: string) => void): () => void
  /**
   * Fired by main's `before-quit` handler, which waits (briefly, bounded) for the resulting
   * `reportLayout` call before writing the file — so a quit landing inside this window's own
   * 500ms layout debounce does not persist stale, already-closed tabs.
   */
  onRequestLayoutFlush(cb: () => void): () => void
  /** Fired when `File > New Session in Folder...` starts a session via the native dialog. */
  onNewSessionStarted(cb: (info: NewSessionInfo) => void): () => void
  ptyWrite(id: string, data: string): void
  ptyResize(id: string, cols: number, rows: number): void
  ptyKill(id: string): void
  /**
   * The pty's screen and history as it stands, so a terminal attaching late — a tab switched
   * back to, a session opened in a second window, a tab moved between panes — is not blank until
   * the program next speaks. A rendered snapshot rather than the raw byte history: see
   * `ScreenBuffers.snapshot`. Paint it at its own `cols`×`rows`, then fit and resize.
   */
  ptySnapshot(id: string): Promise<PtySnapshot | null>
  /** pty id → the Claude session its process is on now, for every running Claude terminal. */
  ptySessions(): Promise<Record<string, PtySessionInfo>>
  /** Fires with the full map whenever any terminal's session or name changes. */
  onPtySessionsChanged(cb: (sessions: Record<string, PtySessionInfo>) => void): () => void
  /** Fires when cached merge-request states have been discarded (the Refresh button) — re-ask. */
  onMrStatusesInvalidated(cb: () => void): () => void
  /**
   * Which of `ids` currently have a live process behind them.
   *
   * Whether a session has a terminal is main-process state, not window state. A window that asked
   * only itself got it wrong in two ways that both ended in an empty pane: a second window never
   * knew about a session the first had started, and a relaunched window restored a tab still set
   * to its terminal view with nothing behind it.
   */
  ptyRunning(ids: string[]): Promise<string[]>
  onPtyData(cb: (id: string, data: string) => void): () => void
  onPtyExit(cb: (id: string, exitCode: number) => void): () => void
  onTreeChanged(cb: () => void): () => void
  onOpenImportDialog(cb: () => void): () => void
  settingsGet(): Promise<AppSettingsPayload>
  settingsSet(settings: AppSettingsPayload): Promise<void>
  onOpenSettingsDialog(cb: () => void): () => void
  /** View > Toggle Sidebar. */
  onToggleSidebar(cb: () => void): () => void
  gitStatus(key: string, isPtyId: boolean): Promise<GitStatus>
  gitListRefs(key: string, isPtyId: boolean): Promise<GitRefs>
  /** Resolves each of the given `!<iid>` references against the session's GitLab remote (if it
   *  has one); a ref with no answer yet — no remote, no glab, a lookup failure — maps to null. */
  gitlabMrRefStatus(
    key: string, isPtyId: boolean, iids: number[],
  ): Promise<Record<number, 'opened' | 'merged' | 'closed' | 'locked' | null>>
  /**
   * Checks out a branch. Resolves with `{ ok: false, conflict }` when another worktree already
   * has it — which is an outcome to act on, not an error to report. Anything else still rejects.
   */
  gitCheckoutBranch(key: string, isPtyId: boolean, name: string): Promise<CheckoutOutcome>
  /** Pulls `branch` in the worktree that holds it. Resolves with that worktree's path and how many commits arrived. */
  gitPullWorktree(key: string, isPtyId: boolean, branch: string): Promise<{ path: string; commits: number }>
  /** Starts a new Claude session in the worktree that holds `branch`. */
  newSessionInWorktree(key: string, isPtyId: boolean, branch: string): Promise<NewSessionInfo>
  gitCheckoutRemote(key: string, isPtyId: boolean, remoteRef: string, localName: string): Promise<void>
  gitCheckoutDetached(key: string, isPtyId: boolean, ref: string): Promise<void>
  gitCreateBranch(key: string, isPtyId: boolean, name: string, from?: string): Promise<void>
  gitPull(key: string, isPtyId: boolean): Promise<{ commits: number }>
  /** Fast-forwards a sidebar folder's branch from its upstream; never merges or rebases. `path`
   *  must be a folder the sidebar shows — main rejects any other. */
  gitPullFolder(path: string): Promise<{ commits: number }>
  gitPush(key: string, isPtyId: boolean): Promise<{ commits: number; published: boolean }>
  gitMerge(key: string, isPtyId: boolean, ref: string): Promise<void>
  gitFetch(key: string, isPtyId: boolean): Promise<void>
  /** Whether VS Code was found on this machine at launch. Checked once; does not change at runtime. */
  vsCodeAvailable(): Promise<boolean>
  /** Opens the session's folder in VS Code. Rejects if VS Code was not found or the folder is gone. */
  openInVsCode(key: string, isPtyId: boolean): Promise<void>
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
  /** Opens an already-downloaded installer again (the assisted flow); reports what happened. */
  updateOpenDownloaded(): Promise<{ ok: 'opened' } | { ok: 'revealed' } | { ok: 'failed'; reason: string }>
  updateSkip(): Promise<void>
  updateDismiss(): Promise<void>
  /** Pushed whenever the updater's state changes, to every window. */
  onUpdateChanged(cb: (status: UpdateStatusPayload) => void): () => void
}

declare global {
  interface Window { apiary: ApiaryApi }
}
