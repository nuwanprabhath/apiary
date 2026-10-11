import { IPC, type IpcKey } from '@shared/ipc/contract'

/**
 * Where each contract channel runs when the window calling it is a remote window (one of a work
 * machine's windows, opened at home over SSH: docs/proposals/2026-10-10-remote-access.md).
 *
 * - `remote`: the work machine's data or processes (sessions, transcripts, chat, terminals, git,
 *   search). The home machine forwards the call over the connection; the work machine runs it
 *   through the same guarded handler a local window would reach. Events of this scope reach a
 *   remote window only from the work machine.
 * - `local`: the home machine's own look, devices and app (theme, pets, menus, clipboard,
 *   spelling, settings, the updater, the usage bar, logs). Handled at home as for any window.
 * - `bridged`: the home machine handles the call, using an answer it asks the work machine for
 *   (`resolve`, `protocol.ts`). Opening VS Code is the case: the work machine resolves the path and
 *   home launches its own VS Code over Remote-SSH on it. The work machine never serves these keys.
 * - `unavailable`: needs the work machine's screen or a local window it does not have (the native
 *   folder picker, moving tabs between windows). The home machine refuses it in a remote window, or
 *   answers with a fixed value where the renderer only asks whether it can (`UNAVAILABLE_ANSWERS`),
 *   so the control hides instead of failing.
 *
 * Every key is classified (`satisfies Record<IpcKey, …>`): a new channel does not compile until
 * someone decides where it runs. The work machine refuses any call whose scope is not `remote`,
 * whatever the client sends.
 */
export type ChannelScope = 'remote' | 'local' | 'bridged' | 'unavailable'

export const CHANNEL_SCOPES = {
  // Sessions, transcripts, search: the work machine's.
  refresh: 'remote',
  tree: 'remote',
  searchContent: 'remote',
  searchRebuild: 'remote',
  searchStatus: 'remote',
  discovered: 'remote',
  importSessions: 'remote',
  transcript: 'remote',
  checkConflict: 'remote',
  resume: 'remote',
  renameSession: 'remote',
  renameTerminalInClaude: 'remote',
  removeSession: 'remote',
  moveSession: 'remote',
  forkSession: 'remote',
  sessionNote: 'remote',
  setSessionNote: 'remote',
  sendPrompt: 'remote',
  treeChanged: 'remote',
  newSessionStarted: 'remote',
  newSessionInProject: 'remote',
  newSessionInWorktree: 'remote',
  newSessionInPickedFolder: 'unavailable',
  // The in-app folder browser stands in for the picker (it also works in a local window, which does not use it).
  folderBrowseOpen: 'remote',
  folderBrowseEnter: 'remote',
  folderBrowseUp: 'remote',
  folderBrowseCrumb: 'remote',
  folderBrowseClose: 'remote',
  newSessionInBrowsedFolder: 'remote',
  readImage: 'remote',
  saveImage: 'remote',
  listWorktrees: 'remote',
  worktreeCreate: 'remote',
  worktreeCreateOptions: 'remote',

  // Terminals.
  openShell: 'remote',
  openShellForPty: 'remote',
  ptyAttach: 'remote',
  ptyDetach: 'remote',
  ptyWrite: 'remote',
  ptyResize: 'remote',
  ptyKill: 'remote',
  ptyResume: 'remote',
  ptyRunning: 'remote',
  ptySessions: 'remote',
  ptySnapshot: 'remote',
  ptyData: 'remote',
  ptyExit: 'remote',
  ptySessionsChanged: 'remote',
  terminalBusy: 'remote',

  // Chat.
  chatAttach: 'remote',
  chatDetach: 'remote',
  chatStart: 'remote',
  chatStop: 'remote',
  chatSend: 'remote',
  chatSendNow: 'remote',
  chatInterrupt: 'remote',
  chatRespond: 'remote',
  chatSetModel: 'remote',
  chatSetEffort: 'remote',
  chatSetPermissionMode: 'remote',
  chatState: 'remote',
  chatChanged: 'remote',
  chatLifecycle: 'remote',

  // Git and merge requests.
  gitStatus: 'remote',
  gitFetch: 'remote',
  gitPull: 'remote',
  gitPush: 'remote',
  gitMerge: 'remote',
  gitListRefs: 'remote',
  gitCreateBranch: 'remote',
  gitCheckoutBranch: 'remote',
  gitCheckoutBranchMovingOther: 'remote',
  gitCheckoutDetached: 'remote',
  gitCheckoutRemote: 'remote',
  gitUpdateBranch: 'remote',
  gitPullFolder: 'remote',
  gitPullWorktree: 'remote',
  gitlabMrRefStatus: 'remote',
  mrStatusesInvalidated: 'remote',

  // The session bar's plugins act on the work machine's sessions, so a remote window's bar shows what
  // the work machine's own plugin settings turn on. Settings → Plugins at home (`pluginList`) lists
  // and configures home's plugins; its `pluginsChanged` is skipped for a remote window, whose bar
  // hears the work machine's instead.
  pluginBarItems: 'remote',
  pluginBarRefresh: 'remote',
  pluginRunAction: 'remote',
  pluginsChanged: 'remote',
  pluginList: 'local',

  // Tabs, layout and the Active section. The work machine keeps no record of a remote window's
  // layout (it has no window number there), so these answer for its tabs without storing them.
  reportLayout: 'remote',
  reportTabs: 'remote',
  activeTabs: 'remote',
  activeTabsChanged: 'remote',
  focusTab: 'remote',
  selectTab: 'remote',
  tabAdopt: 'remote',
  tabClaimed: 'remote',
  tabDropped: 'unavailable',
  tabDetach: 'unavailable',
  tabAdoptHere: 'unavailable',
  requestLayoutFlush: 'local',

  // VS Code opens at home, over Remote-SSH, on a path the work machine resolves.
  vsCodeAvailable: 'local',
  openInVsCode: 'bridged',
  openMentionedFile: 'bridged',

  // The home machine's own look, app and devices.
  themeInitial: 'local',
  themeState: 'local',
  themeApply: 'local',
  themeSave: 'local',
  themeDelete: 'local',
  themeRename: 'local',
  themeGenerate: 'local',
  themeGenerateCancel: 'local',
  themeSetOptions: 'local',
  themeGpuCompositing: 'local',
  themeChanged: 'local',
  setTitleBarColors: 'local',
  settingsGet: 'local',
  settingsSet: 'local',
  openSettingsDialog: 'local',
  openImportDialog: 'local',
  toggleSidebar: 'local',
  appMenu: 'local',
  appMenuInvoke: 'local',
  copyToClipboard: 'local',
  contextMenuRequested: 'local',
  editCommand: 'local',
  spellingCheck: 'local',
  spellingGetLanguages: 'local',
  spellingSetLanguage: 'local',
  updateStatus: 'local',
  updateCheck: 'local',
  updateDownload: 'local',
  updateInstall: 'local',
  updateDismiss: 'local',
  updateSkip: 'local',
  updateOpenDownloaded: 'local',
  updateChanged: 'local',
  statusBarItems: 'local',
  statusBarRefresh: 'local',
  statusBarPanel: 'local',
  statusBarConsent: 'local',
  statusBarChanged: 'local',
  logWrite: 'local',
  logStatus: 'local',
  logClear: 'local',
  logReveal: 'local',

  // Remote access itself: this machine starts ssh and opens the window.
  remoteConnect: 'local',
  remoteStartAndConnect: 'local',
  openRemoteDialog: 'local',
  remoteStatus: 'local',
  remoteHosts: 'local',
  remoteHostsChanged: 'local',
  remoteClients: 'local',
  remoteClientsChanged: 'local',
  remoteDisconnectAll: 'local',
  remotePairing: 'local',
  remotePairingNew: 'local',

  // Pets are not shown in a remote window; their calls stay at home.
  petsState: 'local',
  petsSetEnabled: 'local',
  petsChanged: 'local',
  petGenerate: 'local',
  petGenerateCancel: 'local',
  petUpdate: 'local',
  petDelete: 'local',
  petImport: 'local',
  petExport: 'local',
  petChat: 'local',
  petComment: 'local',
  petVoice: 'local',
  petClaudeActions: 'local',
} as const satisfies Record<IpcKey, ChannelScope>

/** What a remote window is told when it calls an `unavailable` channel that has no fixed answer. */
export const UNAVAILABLE_MESSAGE = 'Not available in a remote window yet.'

/** The `unavailable` channels that answer a value instead of refusing: the renderer only asks whether it can. */
export const UNAVAILABLE_ANSWERS: Partial<Record<IpcKey, unknown>> = {}

export function scopeOf(key: IpcKey): ChannelScope {
  return CHANNEL_SCOPES[key]
}

const SCOPE_BY_CHANNEL = new Map(
  (Object.keys(CHANNEL_SCOPES) as IpcKey[]).flatMap((key) => {
    const spec = IPC[key]
    return 'channel' in spec ? [[spec.channel, CHANNEL_SCOPES[key]] as const] : []
  }),
)

/** The scope of the channel an event is sent on; `local` for a channel the contract does not know. */
export function scopeOfChannel(channel: string): ChannelScope {
  return SCOPE_BY_CHANNEL.get(channel) ?? 'local'
}
