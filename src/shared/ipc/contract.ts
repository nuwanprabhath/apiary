/**
 * The one declarative IPC contract (MAIN-11): every channel Apiary's renderer and main process
 * share, its wire name, its positional argument shape (as a runtime `Guard`) and its result type.
 * `CHANNELS`, `ApiaryApi` (the renderer's bridge type) and the main-side `Handlers`/`Listeners`
 * types used by `main/ipc/registrar.ts` are all *derived* from this map, so they cannot drift
 * from one another the way three hand-written copies (`shared/api.ts`, `preload/index.ts`,
 * `main/ipc.ts`) used to.
 *
 * Channel strings and positional argument order are unchanged from before this file existed —
 * the e2e harness stubs some of them directly (`tests/e2e/helpers.ts`) and `describeError` strips
 * `'apiary:…'` out of Electron's own error text (`renderer/errors.ts`). Do not rename a channel or
 * reorder its arguments here without checking both.
 *
 * Pure data plus guards, deliberately: the preload is sandboxed and must stay free of Node
 * imports, so nothing in this file (or `guards.ts`) may import `electron` or `node:*`.
 */
import {
  invoke, send, invokeLoose, sendLoose, event, sync, local, type Invoke, type Send, type EventSpec, type Local,
} from './define'

export type { EventSpec }
import { type Guard, str, num, bool, any, obj, opaque, record, anyStr, opt, nullable, arr, tuple } from './guards'
import { isTerminalRef, type PtyId, type SessionId, type TerminalRef } from '../domain/ids'
import { isTabTransfer, isWindowLayoutReport, type TabTransfer, type ReportedTab, type WindowLayoutReport, type ActiveTabPayload } from '../domain/tabs'
import { isEditCommand, type ContextMenuRequest, type EditCommand } from '../domain/contextMenu'
import type {
  CheckoutOutcome, FolderWorktree, GitStatus, GitRefs, MrState, WorktreeCreateOptions, WorktreeCreateRequest,
} from '../domain/git'
import { isGitTarget, isWorktreeCreateRequest, type GitTarget } from '../domain/git'
import type {
  ProjectNode, DiscoveredSession, ResumeConflict, NewSessionInfo,
} from '../domain/session'
import type { TranscriptPage } from '../domain/transcript'
import type { AppSettingsPayload } from '../domain/settings'
import type { LogLevel, LogScope, LogStatusPayload } from '../domain/log'
import type { UpdateStatusPayload } from '../domain/update'
import type { PluginInfoPayload, PluginBarItem as PluginBarItemPayload } from '../domain/plugins'
import type { PtySessionInfo, PtySnapshot } from '../domain/pty'
import type { StatusBarItem, StatusBarPanel } from '../domain/statusBar'
import {
  isChatDecision, isChatEffort, isChatModel, isChatPermissionMode,
  type ChatDecision, type ChatEffort, type ChatLifecycle, type ChatModel, type ChatPermissionMode, type ChatState,
  type TerminalBusy,
} from '../domain/chat'
import type { AppMenuNode } from '../domain/windowChrome'
import type { ThemeSpec } from '../theme/spec'
import type { SavedTheme, ThemeOptions, ThemeGenerateResult, ThemeState } from '../theme/state'
import type { PetPatch, PetRecord, PetsState } from '../pets/state'
import type { VoiceContext } from '../pets/prompt'
import { isPetPatch, isVoiceContext } from '../pets/ipcGuards'

// Boundary guards for branded ids (MAIN-21): the one place a string arriving over IPC becomes a
// `SessionId`/`PtyId`/`TerminalRef`, so handlers receive branded values with no cast of their own.
// The wire is unchanged — the ids are still plain strings; only `TerminalRef` is a (tiny) object,
// replacing what used to be a `key, isPtyId` argument pair.
const sessionIdArg: Guard<SessionId> = (v): v is SessionId => typeof v === 'string'
const ptyIdArg: Guard<PtyId> = (v): v is PtyId => typeof v === 'string'
const terminalRefArg: Guard<TerminalRef> = isTerminalRef
const gitTargetArg: Guard<GitTarget> = isGitTarget

type ChatStartOptions = { takeOver: boolean; model?: ChatModel; permissionMode?: ChatPermissionMode; effort?: ChatEffort }
const chatStartOptions: Guard<ChatStartOptions> = (v): v is ChatStartOptions => {
  if (v === null || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.takeOver === 'boolean'
    && (o.model === undefined || isChatModel(o.model))
    && (o.permissionMode === undefined || isChatPermissionMode(o.permissionMode))
    && (o.effort === undefined || isChatEffort(o.effort))
}
const chatDecisionArg: Guard<ChatDecision> = isChatDecision
const chatModelArg: Guard<ChatModel> = isChatModel
const chatModeArg: Guard<ChatPermissionMode> = isChatPermissionMode
const chatEffortArg: Guard<ChatEffort> = isChatEffort

const point: Guard<{ x: number; y: number }> = (v): v is { x: number; y: number } =>
  typeof v === 'object' && v !== null
  && typeof (v as { x?: unknown }).x === 'number' && typeof (v as { y?: unknown }).y === 'number'

/** Loose on purpose: `reportTabs` used to crash the main process on a malformed array from a
 *  stale renderer (`tabs.map`, MAIN-19) because nothing checked its shape before use. This proves
 *  every element is at least an object with the right field types before the handler ever runs. */
const isReportedTab: Guard<ReportedTab> = (v): v is ReportedTab => {
  if (typeof v !== 'object' || v === null) return false
  const t = v as Record<string, unknown>
  return typeof t.key === 'string'
    && (t.view === 'transcript' || t.view === 'terminal')
    && (t.ptyId === null || typeof t.ptyId === 'string')
    && (t.label === null || typeof t.label === 'string')
}

export const IPC = {
  // Sessions and the project tree.
  refresh: invoke<[], void>('apiary:refresh', tuple()),
  tree: invoke<[], ProjectNode[]>('apiary:tree', tuple()),
  searchContent: invoke<[query: string], string[]>('apiary:search-content', tuple(str)),
  discovered: invoke<[], DiscoveredSession[]>('apiary:discovered', tuple()),
  importSessions: invoke<[sessionIds: SessionId[], autoImportProjects: string[]], void>(
    'apiary:import', tuple(arr(sessionIdArg), arr(str)),
  ),
  transcript: invoke<[sessionId: SessionId, beforeIndex?: number], TranscriptPage>(
    'apiary:transcript', tuple(sessionIdArg, opt(num)),
  ),
  checkConflict: invoke<[sessionId: SessionId], ResumeConflict | null>('apiary:check-conflict', tuple(sessionIdArg)),
  resume: invoke<[sessionId: SessionId], void>('apiary:resume', tuple(sessionIdArg)),
  renameSession: invoke<[sessionId: SessionId, title: string], void>('apiary:rename-session', tuple(sessionIdArg, str)),
  renameTerminalInClaude: send<[ptyId: PtyId, title: string]>(
    'apiary:rename-terminal-in-claude', tuple(ptyIdArg, str),
  ),
  removeSession: invoke<[sessionId: SessionId], void>('apiary:remove-session', tuple(sessionIdArg)),
  moveSession: invoke<[sessionId: SessionId, targetProjectPath: string], void>(
    'apiary:move-session', tuple(sessionIdArg, str),
  ),
  newSessionInProject: invoke<[path: string], NewSessionInfo>('apiary:new-session-in-project', tuple(str)),
  /** Asks for a folder with the native picker and starts a session there; null when cancelled. */
  newSessionInPickedFolder: invoke<[], NewSessionInfo | null>('apiary:new-session-in-picked-folder', tuple()),
  forkSession: invoke<[sessionId: SessionId], NewSessionInfo>('apiary:fork-session', tuple(sessionIdArg)),
  newSessionStarted: event<[info: NewSessionInfo]>('apiary:new-session-started'),
  treeChanged: event('apiary:tree-changed'),
  openImportDialog: event('apiary:open-import-dialog'),
  setSessionNote: invoke<[sessionId: SessionId, note: string], void>('apiary:set-session-note', tuple(sessionIdArg, str)),
  sessionNote: invoke<[sessionId: SessionId], string>('apiary:session-note', tuple(sessionIdArg)),
  searchRebuild: invoke<[], void>('apiary:search-rebuild', tuple()),
  searchStatus: invoke<[], { indexed: number; notes: number }>('apiary:search-status', tuple()),
  saveImage: invoke<[base64: string, mediaType: string], string>('apiary:save-image', tuple(str, str)),
  readImage: invoke<[path: string], { dataUrl: string } | null>('apiary:read-image', tuple(str)),
  vsCodeAvailable: invoke<[], boolean>('apiary:vscode-available', tuple()),
  openInVsCode: invoke<[terminal: TerminalRef], void>('apiary:open-in-vscode', tuple(terminalRefArg)),
  /** Opens a file a transcript mentions, named as written; main resolves it inside the session's folder. */
  openMentionedFile: invoke<[terminal: TerminalRef, mention: string], void>('apiary:open-mentioned-file', tuple(terminalRefArg, str)),
  copyToClipboard: invoke<[text: string], void>('apiary:copy-to-clipboard', tuple(str)),

  // Themes.
  themeInitial: sync<ThemeState>('apiary:theme-initial'),
  themeState: invoke<[], ThemeState>('apiary:theme-state', tuple()),
  themeGpuCompositing: invoke<[], boolean>('apiary:theme-gpu-compositing', tuple()),
  themeApply: invoke<[id: string | null], void>('apiary:theme-apply', tuple(nullable(str))),
  themeSave: invoke<[name: string, spec: unknown, prompt?: string], SavedTheme>(
    'apiary:theme-save', tuple(str, opaque, opt(str)),
  ),
  themeRename: invoke<[id: string, name: string], void>('apiary:theme-rename', tuple(str, str)),
  themeDelete: invoke<[id: string], void>('apiary:theme-delete', tuple(str)),
  // Loose: every field is optional and checked one by one in `ThemeStore.setOptions`
  // (a bad field is ignored, not rejected).
  themeSetOptions: invokeLoose<[options: Partial<ThemeOptions>], void>('apiary:theme-set-options', tuple(obj)),
  themeChanged: event<[state: ThemeState]>('apiary:theme-changed'),
  // Loose: `current` is a theme the renderer holds; the handler re-validates it with
  // `validateTheme` (shared/theme/validate.ts) before it reaches the model.
  themeGenerate: invokeLoose<[request: string, current: ThemeSpec | null], ThemeGenerateResult>(
    'apiary:theme-generate', tuple(str, any),
  ),
  themeGenerateCancel: send<[]>('apiary:theme-generate-cancel', tuple()),

  // Pets. A patch and a voice context have real guards (shared/pets/ipcGuards.ts); the handler
  // limits the ranges, and a pet only ever reaches the store through `validatePet`.
  petsState: invoke<[], PetsState>('apiary:pets-state', tuple()),
  petsChanged: event<[state: PetsState]>('apiary:pets-changed'),
  petsSetEnabled: invoke<[on: boolean], void>('apiary:pets-set-enabled', tuple(bool)),
  petGenerate: invoke<[description: string | null, model: string | null], PetRecord>(
    'apiary:pet-generate', tuple(nullable(str), nullable(str)),
  ),
  petGenerateCancel: send<[]>('apiary:pet-generate-cancel', tuple()),
  petUpdate: invoke<[id: string, patch: PetPatch], PetRecord>('apiary:pet-update', tuple(str, isPetPatch)),
  petDelete: invoke<[id: string], void>('apiary:pet-delete', tuple(str)),
  /** Saves the pet to a file the user picks; false when they cancel. */
  petExport: invoke<[id: string], boolean>('apiary:pet-export', tuple(str)),
  /** Adds a pet from a file the user picks; null when they cancel. */
  petImport: invoke<[], PetRecord | null>('apiary:pet-import', tuple()),
  petChat: invoke<[id: string, text: string], string>('apiary:pet-chat', tuple(str, str)),
  petVoice: invoke<[id: string, context: VoiceContext], boolean>('apiary:pet-voice', tuple(str, isVoiceContext)),
  /** What these working sessions are doing: tool and label only (shared/pets/actions.ts). */
  petClaudeActions: invoke<[keys: string[]], { key: string; action: string }[]>('apiary:pet-claude-actions', tuple(arr(str))),
  /** A pet's one-line remark on what Claude is doing; null when it is not time for another. */
  petComment: invoke<[id: string, action: string], string | null>('apiary:pet-comment', tuple(str, str)),

  // Terminals and ptys.
  openShell: invoke<[sessionId: SessionId, tabId: string], void>('apiary:open-shell', tuple(sessionIdArg, str)),
  openShellForPty: invoke<[ptyId: PtyId, tabId: string], void>('apiary:open-shell-for-pty', tuple(ptyIdArg, str)),
  ptyWrite: send<[id: PtyId, data: string]>('apiary:pty-write', tuple(ptyIdArg, str)),
  ptyResize: send<[id: PtyId, cols: number, rows: number]>('apiary:pty-resize', tuple(ptyIdArg, num, num)),
  ptyKill: send<[id: PtyId]>('apiary:pty-kill', tuple(ptyIdArg)),
  /** Sends SIGCONT to a pty's process group: brings back a Claude Code suspended with Ctrl+Z. */
  ptyResume: send<[id: PtyId]>('apiary:pty-resume', tuple(ptyIdArg)),
  /** A `TerminalView` mounted for this pty in the sending window; `ptyData` goes only to attached
   *  windows. Sent before `ptySnapshot` so no output falls between the two. */
  ptyAttach: send<[id: PtyId]>('apiary:pty-attach', tuple(ptyIdArg)),
  ptyDetach: send<[id: PtyId]>('apiary:pty-detach', tuple(ptyIdArg)),
  ptyData: event<[id: PtyId, data: string]>('apiary:pty-data'),
  ptySnapshot: invoke<[id: PtyId], PtySnapshot | null>('apiary:pty-snapshot', tuple(ptyIdArg)),
  ptySessions: invoke<[], Record<string, PtySessionInfo>>('apiary:pty-sessions', tuple()),
  ptySessionsChanged: event<[sessions: Record<string, PtySessionInfo>]>('apiary:pty-sessions-changed'),
  ptyRunning: invoke<[ids: PtyId[]], PtyId[]>('apiary:pty-running', tuple(arr(ptyIdArg))),
  ptyExit: event<[id: PtyId, exitCode: number]>('apiary:pty-exit'),
  sendPrompt: invoke<[ptyId: PtyId, text: string], void>('apiary:send-prompt', tuple(ptyIdArg, str)),

  // Settings.
  settingsGet: invoke<[], AppSettingsPayload>('apiary:settings-get', tuple()),
  // A partial payload is deliberate (CLAUDE.md "Settings arriving over IPC"): a missing field
  // means "leave it alone", so this only proves an object arrived — `mergeSettingsPayload`
  // (src/main/settings.ts) does the field-by-field validation SEC-8 added.
  settingsSet: invokeLoose<[settings: AppSettingsPayload], void>('apiary:settings-set', tuple(obj)),
  openSettingsDialog: event('apiary:open-settings-dialog'),
  toggleSidebar: event('apiary:toggle-sidebar'),

  // Git.
  gitStatus: invoke<[terminal: TerminalRef], GitStatus | null>('apiary:git-status', tuple(terminalRefArg)),
  gitListRefs: invoke<[target: GitTarget], GitRefs>('apiary:git-list-refs', tuple(gitTargetArg)),
  gitlabMrRefStatus: invoke<[terminal: TerminalRef, iids: number[]], Record<number, MrState | null>>(
    'apiary:gitlab-mr-ref-status', tuple(terminalRefArg, arr(num)),
  ),
  gitCheckoutBranch: invoke<[target: GitTarget, name: string], CheckoutOutcome>(
    'apiary:git-checkout-branch', tuple(gitTargetArg, str),
  ),
  /** Checks `branch` out here after moving the worktree that has it to `otherTo` (the conflict
   *  dialog's "switch that worktree to…"). Both worktrees are derived by main from git. */
  gitCheckoutBranchMovingOther: invoke<[target: GitTarget, branch: string, otherTo: string], void>(
    'apiary:git-checkout-branch-moving-other', tuple(gitTargetArg, str, str),
  ),
  gitPullWorktree: invoke<[target: GitTarget, branch: string], { path: string; commits: number }>(
    'apiary:git-pull-worktree', tuple(gitTargetArg, str),
  ),
  newSessionInWorktree: invoke<[target: GitTarget, branch: string], NewSessionInfo>(
    'apiary:new-session-in-worktree', tuple(gitTargetArg, str),
  ),
  gitCheckoutRemote: invoke<[target: GitTarget, remoteRef: string, localName: string], void>(
    'apiary:git-checkout-remote', tuple(gitTargetArg, str, str),
  ),
  gitCheckoutDetached: invoke<[target: GitTarget, ref: string], void>(
    'apiary:git-checkout-detached', tuple(gitTargetArg, str),
  ),
  gitCreateBranch: invoke<[target: GitTarget, name: string, from?: string], void>(
    'apiary:git-create-branch', tuple(gitTargetArg, str, opt(str)),
  ),
  gitPull: invoke<[terminal: TerminalRef], { commits: number }>('apiary:git-pull', tuple(terminalRefArg)),
  gitUpdateBranch: invoke<[target: GitTarget, branch: string], { commits: number }>(
    'apiary:git-update-branch', tuple(gitTargetArg, str),
  ),
  gitPullFolder: invoke<[path: string], { commits: number }>('apiary:git-pull-folder', tuple(str)),
  listWorktrees: invoke<[path: string], FolderWorktree[]>('apiary:list-worktrees', tuple(str)),
  /** What the status-bar plugins show now. Answered from what each already holds — never waits. */
  statusBarItems: invoke<[], StatusBarItem[]>('apiary:status-bar-items', tuple()),
  statusBarRefresh: invoke<[pluginId: string], void>('apiary:status-bar-refresh', tuple(str)),
  /** The dashboard behind an item; null when the plugin has none (or is off). */
  statusBarPanel: invoke<[pluginId: string, itemId: string], StatusBarPanel | null>(
    'apiary:status-bar-panel', tuple(str, str),
  ),
  /** The user's answer to a plugin's consent prompt (an item whose action is `consent`). Declining
   *  switches the plugin off. An id that is not a running plugin, or has nothing to ask, is ignored. */
  statusBarConsent: invoke<[pluginId: string, allow: boolean], void>('apiary:status-bar-consent', tuple(str, bool)),
  statusBarChanged: event('apiary:status-bar-changed'),
  // Chat mode (main/chat/): a session driven over stream-json, as the VS Code extension does.
  chatState: invoke<[sessionId: SessionId], ChatState | null>('apiary:chat-state', tuple(sessionIdArg)),
  chatStart: invoke<[sessionId: SessionId, opts: ChatStartOptions], ChatState>(
    'apiary:chat-start', tuple(sessionIdArg, chatStartOptions),
  ),
  chatSend: invoke<[sessionId: SessionId, text: string], void>('apiary:chat-send', tuple(sessionIdArg, str)),
  chatInterrupt: invoke<[sessionId: SessionId], void>('apiary:chat-interrupt', tuple(sessionIdArg)),
  chatSendNow: invoke<[sessionId: SessionId, queuedId: string], void>('apiary:chat-send-now', tuple(sessionIdArg, str)),
  chatRespond: invoke<[sessionId: SessionId, requestId: string, decision: ChatDecision], void>(
    'apiary:chat-respond', tuple(sessionIdArg, str, chatDecisionArg),
  ),
  chatSetPermissionMode: invoke<[sessionId: SessionId, mode: ChatPermissionMode], void>(
    'apiary:chat-set-permission-mode', tuple(sessionIdArg, chatModeArg),
  ),
  chatSetModel: invoke<[sessionId: SessionId, model: ChatModel], void>('apiary:chat-set-model', tuple(sessionIdArg, chatModelArg)),
  chatSetEffort: invoke<[sessionId: SessionId, effort: ChatEffort], void>('apiary:chat-set-effort', tuple(sessionIdArg, chatEffortArg)),
  chatStop: invoke<[sessionId: SessionId], void>('apiary:chat-stop', tuple(sessionIdArg)),
  /** Whether the session's terminal claude is mid-turn or has background tasks still running —
   *  when it is, the chat sends into that terminal rather than stopping it to take over. */
  terminalBusy: invoke<[sessionId: SessionId], TerminalBusy>('apiary:terminal-busy', tuple(sessionIdArg)),
  /** The sending window shows this session's chat: `chatChanged` for it (and for the session it
   *  was moved from by `/clear`) goes to attached windows only. Sent before `chatState`, so no
   *  update falls between the two. */
  chatAttach: send<[sessionId: SessionId]>('apiary:chat-attach', tuple(sessionIdArg)),
  chatDetach: send<[sessionId: SessionId]>('apiary:chat-detach', tuple(sessionIdArg)),
  chatChanged: event<[state: ChatState]>('apiary:chat-changed'),
  /** A chat started, moved onto a new session, or ended — to every window, shown or not. */
  chatLifecycle: event<[change: ChatLifecycle]>('apiary:chat-lifecycle'),
  /** The application menu, for the themed title bar to draw on Windows and Linux. */
  appMenu: invoke<[], AppMenuNode[]>('apiary:app-menu', tuple()),
  /** Runs the menu item at this path (indices into `appMenu`'s answer). */
  appMenuInvoke: invoke<[path: number[]], void>('apiary:app-menu-invoke', tuple(arr(num))),
  /** The theme's colours for the OS-drawn window controls over the title bar (`#rrggbb`). */
  setTitleBarColors: send<[background: string, symbol: string]>('apiary:set-title-bar-colors', tuple(str, str)),
  /** Branches and naming facts for the "New worktree" dialog on a sidebar folder. */
  worktreeCreateOptions: invoke<[path: string], WorktreeCreateOptions>('apiary:worktree-create-options', tuple(str)),
  /** Creates `<main>.worktrees/<name>` on the chosen branch, then starts a Claude session in it. */
  worktreeCreate: invoke<[path: string, request: WorktreeCreateRequest], NewSessionInfo>(
    'apiary:worktree-create', tuple(str, isWorktreeCreateRequest),
  ),
  gitPush: invoke<[terminal: TerminalRef], { commits: number; published: boolean }>(
    'apiary:git-push', tuple(terminalRefArg),
  ),
  gitMerge: invoke<[target: GitTarget, ref: string], void>('apiary:git-merge', tuple(gitTargetArg, str)),
  gitFetch: invoke<[terminal: TerminalRef], void>('apiary:git-fetch', tuple(terminalRefArg)),
  mrStatusesInvalidated: event('apiary:mr-statuses-invalidated'),

  // Update.
  updateStatus: invoke<[], UpdateStatusPayload>('apiary:update-status', tuple()),
  updateCheck: invoke<[], UpdateStatusPayload>('apiary:update-check', tuple()),
  updateDownload: invoke<[], UpdateStatusPayload>('apiary:update-download', tuple()),
  updateInstall: invoke<[], void>('apiary:update-install', tuple()),
  updateOpenDownloaded: invoke<[], { ok: 'opened' } | { ok: 'revealed' } | { ok: 'failed'; reason: string }>(
    'apiary:update-open-downloaded', tuple(),
  ),
  updateSkip: invoke<[], void>('apiary:update-skip', tuple()),
  updateDismiss: invoke<[], void>('apiary:update-dismiss', tuple()),
  updateChanged: event<[status: UpdateStatusPayload]>('apiary:update-changed'),

  // Session-bar plugins.
  pluginBarItems: invoke<[terminal: TerminalRef], PluginBarItemPayload[]>(
    'apiary:plugin-bar-items', tuple(terminalRefArg),
  ),
  pluginBarRefresh: invoke<[terminal: TerminalRef], PluginBarItemPayload[]>(
    'apiary:plugin-bar-refresh', tuple(terminalRefArg),
  ),
  // Loose: the bar item is echoed back from what main sent; the handler (handlers/plugins.ts) reads
  // only `action` and opens an http(s) URL, nothing else of it is trusted.
  pluginRunAction: invokeLoose<[item: PluginBarItemPayload], void>('apiary:plugin-run-action', tuple(obj)),
  pluginList: invoke<[], PluginInfoPayload[]>('apiary:plugin-list', tuple()),
  pluginsChanged: event('apiary:plugins-changed'),

  // Diagnostic log.
  logStatus: invoke<[], LogStatusPayload>('apiary:log-status', tuple()),
  logReveal: invoke<[], string>('apiary:log-reveal', tuple()),
  logClear: invoke<[], LogStatusPayload>('apiary:log-clear', tuple()),
  // Loose: `level`/`scope` are checked only as strings (`LogLevel`/`LogScope` bind the renderer's
  // own callers at compile time); `Logger.log` is the validator for what is written — it prefixes
  // the scope with `renderer:`, redacts every field and lets no field override the fixed keys.
  logWrite: sendLoose<[level: LogLevel, scope: LogScope, message: string, fields?: Record<string, unknown>]>(
    'apiary:log-write', tuple(anyStr, anyStr, str, opt(record)),
  ),

  // Tabs, layout and windows.
  tabDropped: invoke<[tab: TabTransfer, at: { x: number; y: number }], void>(
    'apiary:tab-dropped', tuple(isTabTransfer, point),
  ),
  tabDetach: invoke<[tab: TabTransfer, at: { x: number; y: number }], void>(
    'apiary:tab-detach', tuple(isTabTransfer, point),
  ),
  tabAdoptHere: invoke<[tab: TabTransfer], void>('apiary:tab-adopt-here', tuple(isTabTransfer)),
  tabAdopt: event<[tab: TabTransfer]>('apiary:tab-adopt'),
  tabClaimed: event<[key: string]>('apiary:tab-claimed'),
  // `isWindowLayoutReport` is the same deep check `resolveReportLayout` (`main/windows/reportLayoutGuard.ts`)
  // applies; that one then stamps the sender's own window number over the payload's.
  reportLayout: invoke<[report: WindowLayoutReport], void>('apiary:report-layout', tuple(isWindowLayoutReport)),
  requestLayoutFlush: event('apiary:request-layout-flush'),
  reportTabs: send<[tabs: ReportedTab[]]>('apiary:report-tabs', tuple(arr(isReportedTab))),
  activeTabs: invoke<[], ActiveTabPayload[]>('apiary:active-tabs', tuple()),
  activeTabsChanged: event('apiary:active-tabs-changed'),
  focusTab: invoke<[windowNumber: number, key: string], void>('apiary:focus-tab', tuple(num, str)),
  selectTab: event<[key: string]>('apiary:select-tab'),

  // Spelling.
  spellingGetLanguages: invoke<[], string[]>('apiary:spelling-get-languages', tuple()),
  spellingSetLanguage: invoke<[language: string], void>('apiary:spelling-set-language', tuple(str)),

  /** A right-click in a window; the page answers it with its own menu at `x`, `y`. */
  contextMenuRequested: event<[request: ContextMenuRequest]>('apiary:context-menu-requested'),
  /** An edit the page chose from its menu, made on the window's focused field. */
  editCommand: send<[command: EditCommand]>('apiary:edit-command', tuple(isEditCommand)),

  // Local preload-only APIs (not exposed over IPC).
  spellingCheck: local<[word: string], { misspelled: boolean; suggestions: string[] }>(tuple(str)),
} as const

type Spec = typeof IPC
export type IpcKey = keyof Spec
export type InvokeKey = { [K in IpcKey]: Spec[K] extends Invoke<unknown[], unknown> ? K : never }[IpcKey]
export type SendKey = { [K in IpcKey]: Spec[K] extends Send<unknown[]> ? K : never }[IpcKey]
export type EventKey = { [K in IpcKey]: Spec[K] extends EventSpec<unknown[]> ? K : never }[IpcKey]
export type LocalKey = { [K in IpcKey]: Spec[K] extends Local<unknown[], unknown> ? K : never }[IpcKey]
export type ArgsOf<K extends IpcKey> = Spec[K] extends Invoke<infer A, unknown> | Send<infer A> | Local<infer A, unknown> ? A : never
export type ResultOf<K extends InvokeKey | LocalKey> = Spec[K] extends Invoke<unknown[], infer R> | Local<unknown[], infer R> ? R : never
export type PayloadOf<K extends EventKey> = Spec[K] extends EventSpec<infer P> ? P : never

/** Kept for e2e/tests and existing imports: identical strings to before this file existed. */
export const CHANNELS = Object.fromEntries(
  Object.entries(IPC).flatMap(([k, s]) => (s.kind === 'local' ? [] : [[k, s.channel] as const])),
) as { [K in Exclude<IpcKey, LocalKey>]: Spec[K] extends { channel: infer C } ? C : never }

/**
 * What `window.apiary` is: derived, so it can never disagree with what main registers.
 * `main/ipc/registrar.ts`'s `Handlers`/`Listeners` types are derived from the same `InvokeKey`/
 * `SendKey`, so a channel with no main-side handler — or one whose handler's signature drifted
 * from this — is a compile error on the main side, not a "No handler registered" thrown at
 * runtime the first time someone clicks the button.
 */
export type ApiaryApi =
  { [K in InvokeKey]: (...a: ArgsOf<K>) => Promise<ResultOf<K>> }
  & { [K in SendKey]: (...a: ArgsOf<K>) => void }
  & { [K in EventKey as `on${Capitalize<K & string>}`]: (cb: (...p: PayloadOf<K>) => void) => () => void }
  & { [K in LocalKey]: (...a: ArgsOf<K>) => ResultOf<K> }
  & { initialTheme: ThemeState }
