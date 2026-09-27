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
import { type Guard, str, bool, num, any, obj, opt, nullable, arr, tuple } from './guards'
import { isTabTransfer, type TabTransfer, type ReportedTab, type WindowLayoutReport, type ActiveTabPayload } from '../domain/tabs'
import type {
  CheckoutOutcome, FolderWorktree, GitStatus, GitRefs, MrState,
} from '../domain/git'
import type {
  ProjectNode, DiscoveredSession, ResumeConflict, NewSessionInfo,
} from '../domain/session'
import type { TranscriptPage } from '../domain/transcript'
import type { AppSettingsPayload } from '../domain/settings'
import type { LogLevel, LogScope, LogStatusPayload } from '../domain/log'
import type { UpdateStatusPayload } from '../domain/update'
import type { PluginInfoPayload, PluginBarItem as PluginBarItemPayload } from '../domain/plugins'
import type { PtySessionInfo, PtySnapshot } from '../domain/pty'
import type { ThemeSpec } from '../theme/spec'
import type { SavedTheme, ThemeOptions, ThemeGenerateResult, ThemeState } from '../theme/state'

interface Invoke<A extends unknown[], R> { kind: 'invoke'; channel: string; args: Guard<A>; _r?: R }
interface Send<A extends unknown[]> { kind: 'send'; channel: string; args: Guard<A> }
interface Event<P extends unknown[]> { kind: 'event'; channel: string; _p?: P }
interface Sync<R> { kind: 'sync'; channel: string; _r?: R }

// `args` takes a `Guard<any>` rather than `Guard<A>`: several channels below intentionally use a
// *looser* runtime check than their declared type (a permissive `tuple(obj)` standing in for a
// full `AppSettingsPayload`, `str` standing in for the `LogLevel`/`LogScope` string unions) — see
// "Start with permissive guards" in MAIN-11. The cast is trusted at the call site, one line per
// channel, rather than forcing every guard to fully re-derive its declared type structurally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- guard proves a looser shape than `A`, deliberately (see comment above)
const invoke = <A extends unknown[], R>(channel: string, args: Guard<any>): Invoke<A, R> =>
  ({ kind: 'invoke', channel, args: args as Guard<A> })
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see `invoke` above
const send = <A extends unknown[]>(channel: string, args: Guard<any>): Send<A> =>
  ({ kind: 'send', channel, args: args as Guard<A> })
const event = <P extends unknown[] = []>(channel: string): Event<P> => ({ kind: 'event', channel })
const sync = <R>(channel: string): Sync<R> => ({ kind: 'sync', channel })

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
  importSessions: invoke<[sessionIds: string[], autoImportProjects: string[]], void>(
    'apiary:import', tuple(arr(str), arr(str)),
  ),
  transcript: invoke<[sessionId: string, beforeIndex?: number], TranscriptPage>(
    'apiary:transcript', tuple(str, opt(num)),
  ),
  checkConflict: invoke<[sessionId: string], ResumeConflict | null>('apiary:check-conflict', tuple(str)),
  resume: invoke<[sessionId: string], void>('apiary:resume', tuple(str)),
  renameSession: invoke<[sessionId: string, title: string], void>('apiary:rename-session', tuple(str, str)),
  renameTerminalInClaude: send<[ptyId: string, title: string]>(
    'apiary:rename-terminal-in-claude', tuple(str, str),
  ),
  removeSession: invoke<[sessionId: string], void>('apiary:remove-session', tuple(str)),
  moveSession: invoke<[sessionId: string, targetProjectPath: string], void>(
    'apiary:move-session', tuple(str, str),
  ),
  newSessionInProject: invoke<[path: string], NewSessionInfo>('apiary:new-session-in-project', tuple(str)),
  forkSession: invoke<[sessionId: string], NewSessionInfo>('apiary:fork-session', tuple(str)),
  newSessionStarted: event<[info: NewSessionInfo]>('apiary:new-session-started'),
  treeChanged: event('apiary:tree-changed'),
  openImportDialog: event('apiary:open-import-dialog'),
  setSessionNote: invoke<[sessionId: string, note: string], void>('apiary:set-session-note', tuple(str, str)),
  sessionNote: invoke<[sessionId: string], string>('apiary:session-note', tuple(str)),
  searchRebuild: invoke<[], void>('apiary:search-rebuild', tuple()),
  searchStatus: invoke<[], { indexed: number; notes: number }>('apiary:search-status', tuple()),
  saveImage: invoke<[base64: string, mediaType: string], string>('apiary:save-image', tuple(str, str)),
  readImage: invoke<[path: string], { dataUrl: string } | null>('apiary:read-image', tuple(str)),
  vsCodeAvailable: invoke<[], boolean>('apiary:vscode-available', tuple()),
  openInVsCode: invoke<[key: string, isPtyId: boolean], void>('apiary:open-in-vscode', tuple(str, bool)),
  copyToClipboard: invoke<[text: string], void>('apiary:copy-to-clipboard', tuple(str)),

  // Themes.
  themeInitial: sync<ThemeState>('apiary:theme-initial'),
  themeState: invoke<[], ThemeState>('apiary:theme-state', tuple()),
  themeGpuCompositing: invoke<[], boolean>('apiary:theme-gpu-compositing', tuple()),
  themeApply: invoke<[id: string | null], void>('apiary:theme-apply', tuple(nullable(str))),
  themeSave: invoke<[name: string, spec: unknown, prompt?: string], SavedTheme>(
    'apiary:theme-save', tuple(str, any, opt(str)),
  ),
  themeRename: invoke<[id: string, name: string], void>('apiary:theme-rename', tuple(str, str)),
  themeDelete: invoke<[id: string], void>('apiary:theme-delete', tuple(str)),
  themeSetOptions: invoke<[options: Partial<ThemeOptions>], void>('apiary:theme-set-options', tuple(obj)),
  themeChanged: event<[state: ThemeState]>('apiary:theme-changed'),
  themeGenerate: invoke<[request: string, current: ThemeSpec | null], ThemeGenerateResult>(
    'apiary:theme-generate', tuple(str, any),
  ),
  themeGenerateCancel: send<[]>('apiary:theme-generate-cancel', tuple()),

  // Terminals and ptys.
  openShell: invoke<[sessionId: string, tabId: string], void>('apiary:open-shell', tuple(str, str)),
  openShellForPty: invoke<[ptyId: string, tabId: string], void>('apiary:open-shell-for-pty', tuple(str, str)),
  ptyWrite: send<[id: string, data: string]>('apiary:pty-write', tuple(str, str)),
  ptyResize: send<[id: string, cols: number, rows: number]>('apiary:pty-resize', tuple(str, num, num)),
  ptyKill: send<[id: string]>('apiary:pty-kill', tuple(str)),
  ptyData: event<[id: string, data: string]>('apiary:pty-data'),
  ptySnapshot: invoke<[id: string], PtySnapshot | null>('apiary:pty-snapshot', tuple(str)),
  ptySessions: invoke<[], Record<string, PtySessionInfo>>('apiary:pty-sessions', tuple()),
  ptySessionsChanged: event<[sessions: Record<string, PtySessionInfo>]>('apiary:pty-sessions-changed'),
  ptyRunning: invoke<[ids: string[]], string[]>('apiary:pty-running', tuple(arr(str))),
  ptyExit: event<[id: string, exitCode: number]>('apiary:pty-exit'),
  sendPrompt: invoke<[ptyId: string, text: string], void>('apiary:send-prompt', tuple(str, str)),

  // Settings.
  settingsGet: invoke<[], AppSettingsPayload>('apiary:settings-get', tuple()),
  // A partial payload is deliberate (CLAUDE.md "Settings arriving over IPC"): a missing field
  // means "leave it alone", so this only proves an object arrived — `mergeSettingsPayload`
  // (src/main/settings.ts) does the field-by-field validation SEC-8 added.
  settingsSet: invoke<[settings: AppSettingsPayload], void>('apiary:settings-set', tuple(obj)),
  openSettingsDialog: event('apiary:open-settings-dialog'),
  toggleSidebar: event('apiary:toggle-sidebar'),

  // Git.
  gitStatus: invoke<[key: string, isPtyId: boolean], GitStatus | null>('apiary:git-status', tuple(str, bool)),
  gitListRefs: invoke<[key: string, isPtyId: boolean], GitRefs>('apiary:git-list-refs', tuple(str, bool)),
  gitlabMrRefStatus: invoke<[key: string, isPtyId: boolean, iids: number[]], Record<number, MrState | null>>(
    'apiary:gitlab-mr-ref-status', tuple(str, bool, arr(num)),
  ),
  gitCheckoutBranch: invoke<[key: string, isPtyId: boolean, name: string], CheckoutOutcome>(
    'apiary:git-checkout-branch', tuple(str, bool, str),
  ),
  gitPullWorktree: invoke<[key: string, isPtyId: boolean, branch: string], { path: string; commits: number }>(
    'apiary:git-pull-worktree', tuple(str, bool, str),
  ),
  newSessionInWorktree: invoke<[key: string, isPtyId: boolean, branch: string], NewSessionInfo>(
    'apiary:new-session-in-worktree', tuple(str, bool, str),
  ),
  gitCheckoutRemote: invoke<[key: string, isPtyId: boolean, remoteRef: string, localName: string], void>(
    'apiary:git-checkout-remote', tuple(str, bool, str, str),
  ),
  gitCheckoutDetached: invoke<[key: string, isPtyId: boolean, ref: string], void>(
    'apiary:git-checkout-detached', tuple(str, bool, str),
  ),
  gitCreateBranch: invoke<[key: string, isPtyId: boolean, name: string, from?: string], void>(
    'apiary:git-create-branch', tuple(str, bool, str, opt(str)),
  ),
  gitPull: invoke<[key: string, isPtyId: boolean], { commits: number }>('apiary:git-pull', tuple(str, bool)),
  gitUpdateBranch: invoke<[key: string, isPtyId: boolean, branch: string], { commits: number }>(
    'apiary:git-update-branch', tuple(str, bool, str),
  ),
  gitPullFolder: invoke<[path: string], { commits: number }>('apiary:git-pull-folder', tuple(str)),
  listWorktrees: invoke<[path: string], FolderWorktree[]>('apiary:list-worktrees', tuple(str)),
  gitPush: invoke<[key: string, isPtyId: boolean], { commits: number; published: boolean }>(
    'apiary:git-push', tuple(str, bool),
  ),
  gitMerge: invoke<[key: string, isPtyId: boolean, ref: string], void>('apiary:git-merge', tuple(str, bool, str)),
  gitFetch: invoke<[key: string, isPtyId: boolean], void>('apiary:git-fetch', tuple(str, bool)),
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
  pluginBarItems: invoke<[key: string, isPtyId: boolean], PluginBarItemPayload[]>(
    'apiary:plugin-bar-items', tuple(str, bool),
  ),
  pluginBarRefresh: invoke<[key: string, isPtyId: boolean], PluginBarItemPayload[]>(
    'apiary:plugin-bar-refresh', tuple(str, bool),
  ),
  pluginRunAction: invoke<[item: PluginBarItemPayload], void>('apiary:plugin-run-action', tuple(obj)),
  pluginList: invoke<[], PluginInfoPayload[]>('apiary:plugin-list', tuple()),
  pluginsChanged: event('apiary:plugins-changed'),

  // Diagnostic log.
  logStatus: invoke<[], LogStatusPayload>('apiary:log-status', tuple()),
  logReveal: invoke<[], string>('apiary:log-reveal', tuple()),
  logClear: invoke<[], LogStatusPayload>('apiary:log-clear', tuple()),
  logWrite: send<[level: LogLevel, scope: LogScope, message: string, fields?: Record<string, unknown>]>(
    'apiary:log-write', tuple(str, str, str, opt(obj)),
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
  // Deep-validated inside `resolveReportLayout` (`main/windows/reportLayoutGuard.ts`), which also needs
  // to know this window's number — kept permissive here rather than duplicated.
  reportLayout: invoke<[report: WindowLayoutReport], void>('apiary:report-layout', tuple(any)),
  requestLayoutFlush: event('apiary:request-layout-flush'),
  reportTabs: send<[tabs: ReportedTab[]]>('apiary:report-tabs', tuple(arr(isReportedTab))),
  activeTabs: invoke<[], ActiveTabPayload[]>('apiary:active-tabs', tuple()),
  activeTabsChanged: event('apiary:active-tabs-changed'),
  focusTab: invoke<[windowNumber: number, key: string], void>('apiary:focus-tab', tuple(num, str)),
  selectTab: event<[key: string]>('apiary:select-tab'),
} as const

type Spec = typeof IPC
export type IpcKey = keyof Spec
export type InvokeKey = { [K in IpcKey]: Spec[K] extends Invoke<unknown[], unknown> ? K : never }[IpcKey]
export type SendKey = { [K in IpcKey]: Spec[K] extends Send<unknown[]> ? K : never }[IpcKey]
export type EventKey = { [K in IpcKey]: Spec[K] extends Event<unknown[]> ? K : never }[IpcKey]
export type ArgsOf<K extends IpcKey> = Spec[K] extends Invoke<infer A, unknown> | Send<infer A> ? A : never
export type ResultOf<K extends InvokeKey> = Spec[K] extends Invoke<unknown[], infer R> ? R : never
export type PayloadOf<K extends EventKey> = Spec[K] extends Event<infer P> ? P : never

/** Kept for e2e/tests and existing imports: identical strings to before this file existed. */
export const CHANNELS = Object.fromEntries(
  Object.entries(IPC).map(([k, s]) => [k, s.channel]),
) as { [K in IpcKey]: Spec[K]['channel'] }

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
  & { initialTheme: ThemeState }
