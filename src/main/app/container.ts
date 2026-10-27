import { dirname, join } from 'node:path'
import { BrowserWindow, webContents } from 'electron'
import { AppService, DisposedFlag } from '../appService'
import { ClaudeProjectsSource, type SessionSource } from '../sources/claudeProjects'
import { SessionStore } from '../store/sessionStore'
import { PtyManager } from '../pty/ptyManager'
import type { PromptPathOptions } from '../pty/promptPath'
import { SessionResolver } from '../sessions/sessionResolver'
import { SessionCatalog } from '../sessions/sessionCatalog'
import { SessionActions } from '../sessions/sessionActions'
import { SessionWatcher } from '../sessions/sessionWatcher'
import { TranscriptService } from '../sessions/transcriptService'
import { forEachMessageFrom } from '../transcript/transcriptLines'
import { claudeTaskRoots } from '../sessions/backgroundTaskOutput'
import { TranscriptReader } from '../transcript/transcriptReader'
import { WorktreeResolver, createResolverExec } from '../git/worktreeResolver'
import { BranchOps, createBranchExec } from '../git/branchOps'
import { MrStatusCache, createMrExec } from '../git/mrStatusCache'
import { GitService } from '../git/gitService'
import { SearchIndex } from '../search/searchIndex'
import { SearchClient } from '../search/searchClient'
import { SearchService } from '../search/searchService'
import { TerminalService } from '../terminals/terminalService'
import { ActiveTabsService } from '../terminals/activeTabsService'
import { VsCodeService } from '../vscode/vscodeService'
import { ImageStore } from '../media/imageStore'
import { ChatManager, type SpawnChat } from '../chat/chatManager'
import { ChatService } from '../chat/chatService'
import { ClaudeOneShot } from '../claude/claudeOneShot'
import { PluginRegistry } from '../plugins/registry'
import { PluginService } from '../plugins/pluginService'
import { StatusBarRegistry } from '../statusBar/registry'
import type { ConsentStorage } from '../statusBar/claudeUsage/consent'
import type { ChatLifecycle } from '@shared/domain/chat'
import type { PluginSettingValues } from '@shared/domain/plugins'
import { fireAndForget } from '../log/fireAndForget'
import { ClaudeSessionTracker } from '../claude/claudeSessionTracker'
import { rememberAccounts, trackedProcesses, type TrackerAccounts } from '../claude/trackerAccounts'
import { PtyDataCoalescer } from '../terminals/ptyDataCoalescer'
import { ActivityBroadcaster } from '../terminals/activityBroadcaster'
import { TabMover } from '../windows/tabMover'
import type { IpcState } from '../ipc/ipcState'
import type { TabTransfer } from '@shared/types'
import { SettingsService } from '../settings/settingsService'
import { createSessionLayoutStore, type SessionLayoutStore } from '../windows/sessionLayoutStore'
import { createLayoutFlushCoordinator, type LayoutFlushCoordinator } from '../windows/layoutFlushCoordinator'
import { TabRegistry } from '../windows/tabRegistry'
import { WindowManager } from '../windows/windowManager'
import { ThemeStore, DEFAULT_THEME_ID } from '../theme/themeStore'
import { ThemeGenerator } from '../theme/themeGenerator'
import { PetStore } from '../pets/petStore'
import { PetService } from '../pets/petService'
import { PetPlacement } from '../pets/petPlacement'
import { petWindowing } from '../pets/petWindows'
import { createUpdater } from '../update/createUpdater'
import type { UpdateService } from '../update/updateService'
import { broadcast } from '../windows/broadcast'
import { WindowAttachments } from '../windows/windowAttachments'
import type { PairingStore } from '../remote/pairingStore'
import type { RemoteServer } from '../remote/remoteServer'
import type { RemoteClientsFeed } from '../statusBar/remoteClients'
import type { RemoteWindows } from '../remote/remoteWindows'
import type { RemoteClientService } from '../remote/remoteClientService'
import type { HostDirectory } from '../remote/hostDirectory'
import { createRemoteConnecting, createRemoteServing, realConnectingOutside } from './remoteContainer'
import type { VirtualContentsRegistry } from '../remote/virtualContents'
import { IPC } from '@shared/api'
import type { RuntimeEnv } from './env'
import { SpellingService } from '../spelling/spellingService'
import { FolderBrowser } from '../folders/folderBrowser'
import { LibraryStateService } from '../library/libraryStateService'
import { AccountService, createAccountsStore } from '../accounts/accountService'
import { createExec, type ExecFn } from '../exec/run'
import type { ContainerPaths } from './containerPaths'

/**
 * The composition root: every long-lived main-process object and what it is built from.
 *
 * Construction only: nothing here opens a window, starts a timer, refreshes, registers a handler
 * or touches `electron`'s `app`. What needs Electron is resolved by `index.ts` and passed in,
 * which lets a unit test build the whole graph. (`SettingsService`'s constructor does read and
 * migrate `settings.json`.) `registerIpc`, starting the updater and status bar, and shutdown
 * ordering stay in `index.ts`.
 */
export interface ContainerInputs {
  /** Resolved by `index.ts` (`detectVsCode` or the test override); null when VS Code was not found. */
  vsCodePath: string | null
  /** `writeZshShim(...)`'s result — a file write, so done by the caller. */
  zshPromptShim: string
  /** The directory `index.ts` resolves its own files from, handed to `WindowManager`. */
  dirname: string
  /** `process.platform === 'darwin'`-style gate for reading the Keychain — never for a test fixture. */
  statusBarKeychain: boolean
  /** `hasDeveloperIdSignature()` on a packaged macOS build, else false — an async `codesign`, so asked by the caller. */
  macSigned: boolean
  /** Read lazily by `WindowManager` (the quit-deferral is installed after the container exists). */
  isQuitting: () => boolean
  /** Remote access (`remote/remoteServer.ts`): the home directory holding `.apiary/remote.sock`, this machine's name and the app version. */
  homeDir: string
  host: string
  appVersion: string
}

const ACTIVITY_BROADCAST_MS = 500

export interface IpcStateInputs {
  pty: PtyManager
  configRoot: string
  tabRegistry: TabRegistry | null
  /** Opens a tab in a window of its own, resolving the new window's number. */
  openDetachedWindow: (tab: TabTransfer, at: { x: number; y: number }) => number
  windowNumberFor: (webContentsId: number) => number | null
  /** Remote windows, which `ptyData` reaches once they attach; none when omitted. */
  virtualContents?: VirtualContentsRegistry
  /** Where each account's pid files are, and where a resolved session's account is recorded. */
  accounts: TrackerAccounts
}

export function createIpcState(inputs: IpcStateInputs): IpcState {
  const ptyAttachments = new WindowAttachments((wcId) => webContents.fromId(wcId) ?? inputs.virtualContents?.get(wcId) ?? null)
  return {
    sessionTracker: new ClaudeSessionTracker({
      // Each `claude` writes its pid file under its own account's config folder.
      processes: () => trackedProcesses(inputs.pty, inputs.configRoot, inputs.accounts),
      onChange: (sessions) => {
        rememberAccounts(sessions, inputs.pty, inputs.accounts)
        broadcast(IPC.ptySessionsChanged, sessions)
        broadcast(IPC.activeTabsChanged)
      },
    }),
    ptyAttachments,
    ptyCoalescer: new PtyDataCoalescer({
      onFlush: (id, data) => { ptyAttachments.sendTo(id, IPC.ptyData, id, data) },
    }),
    activity: new ActivityBroadcaster({
      onBroadcast: () => { broadcast(IPC.activeTabsChanged) },
      intervalMs: ACTIVITY_BROADCAST_MS,
    }),
    tabMover: new TabMover({
      getWindows: () => BrowserWindow.getAllWindows(),
      tabRegistry: inputs.tabRegistry,
      pty: inputs.pty,
      openDetachedWindow: inputs.openDetachedWindow,
      windowNumberFor: inputs.windowNumberFor,
    }),
  }
}

export interface Container {
  paths: ContainerPaths
  settingsService: SettingsService
  sessionLayoutStore: SessionLayoutStore
  layoutFlushCoordinator: LayoutFlushCoordinator
  tabRegistry: TabRegistry
  windowManager: WindowManager
  service: AppService
  /** Chat mode and the plugins, which their handlers take directly rather than through `service`. */
  chat: ChatService
  plugins: PluginService
  /** Spell checking service for all windows. */
  spelling: SpellingService
  /** The folder browser a remote window uses in place of the native picker. */
  folderBrowser: FolderBrowser
  /** What the IPC handlers share between channels (`registerIpc` takes it). */
  ipcState: IpcState
  /** New session files appear without a restart; `index.ts` starts it before the first refresh. */
  sessionWatcher: SessionWatcher
  updater: UpdateService | null
  themeStore: ThemeStore
  themeGenerator: ThemeGenerator
  petStore: PetStore
  petService: PetService
  petPlacement: PetPlacement
  /** What each open tab is doing, for the Active section (`activeTabs`). */
  activeTabs: ActiveTabsService
  /** The work machine's end of remote access; `index.ts` starts and stops it with the setting. */
  remoteServer: RemoteServer
  /** The work machine's pairing code (`remote-pairing.json`). */
  remotePairing: PairingStore
  virtualContents: VirtualContentsRegistry
  /** The home machine's side: which windows show a work machine, and where their calls go. */
  remoteWindows: RemoteWindows
  /** The home machine's end of remote access: ssh, the forwarded socket and the remote windows. */
  remoteClient: RemoteClientService
  hostDirectory: HostDirectory
  /** The sessions library's arrangement and reading preferences, mirrored to remote windows. */
  library: LibraryStateService
  accounts: AccountService
}

/** What the session-side services are built from; optional fields default to the app's, so a test names only what it needs. */
export interface ServicesOptions {
  configRoot: string
  dbPath: string
  /** Where the Claude accounts live: the list file and the folders. Default: beside the database. */
  accountsFile?: string
  accountsDir?: string
  /** The user's home folder: where the main account's Claude JSON sits, and where a login session runs. */
  homeDir: string
  /** Test-only: the command runner and platform removing an account's Keychain item goes through. */
  accountsOutside?: { exec: ExecFn; platform: NodeJS.Platform }
  /** An account was added, removed or made the default. */
  onAccountsChanged?: () => void
  /** A live session's account changed (`sessionAccountsChanged`). */
  onSessionAccountsChanged?: () => void
  detectLive?: () => Promise<Map<string, number>>
  /** A scan outside a refresh pass changed who is live (the throttled follow-up): re-send the tree. */
  onLiveChanged?: () => void
  claudeBin?: string
  autoImportAll?: boolean
  /** Where images pasted into the composer are written. Defaults beside the database. */
  imagesDir?: string
  /** Where the full-text search index lives. Defaults beside the database. */
  searchDbPath?: string
  /** Whether search also looks inside conversations. */
  searchChatContent?: boolean
  searchSessionNotes?: boolean
  promptPath?: PromptPathOptions
  /** The zsh startup shim the minimal prompt needs (see pty/promptPath.ts), or none. */
  zshPromptShim?: string
  /** Which session-bar plugins are switched on, by plugin id. */
  plugins?: Record<string, boolean>
  /** Each plugin's own settings, namespaced by plugin id. */
  pluginSettings?: Record<string, PluginSettingValues>
  /** Path to the `glab` executable, for anyone whose install is not on PATH (and for tests). */
  glabPath?: string
  /** Path to the `code` CLI, resolved once at startup by `detectVsCode`. Null when none was found. */
  vsCodePath?: string | null
  /** Called when a plugin's contribution to a bar changed, so windows can re-read it. */
  onPluginsChanged?: () => void
  /** The status bar's items changed (a usage poll landed, a plugin was switched off). */
  onStatusBarChanged?: () => void
  /** Which windows show which chat, how every window hears a chat started, moved or ended, and
   *  that a chat's activity moved (see `ChatService`). Defaults to no windows. */
  chat?: { attachments: WindowAttachments; announce: (change: ChatLifecycle) => void; activityChanged: () => void }
  /** The open tabs the Active section reads. Defaults to none, so a test that shows no tabs needs no registry. */
  tabs?: Pick<TabRegistry, 'list'>
  /** Test-only: starts chat processes instead of a login shell running `claude`. */
  chatSpawn?: SpawnChat
  /** Let the Claude usage plugin read the macOS Keychain: only against the real `~/.claude`,
   *  never a test fixture's, since a Keychain read can put a permission prompt on screen. */
  statusBarKeychain?: boolean; fakeUsage?: string // fakeUsage, test-only (`APIARY_FAKE_USAGE`): the JSON the usage plugin shows in place of the sign-in and the usage endpoint
  /** Where the answer to the usage plugin's consent prompt is kept. Omitted: in memory only, so
   *  a test (or a caller that persists nothing) is asked, and reads nothing, until it answers. */
  claudeUsageConsent?: ConsentStorage
  /** Who is connected to this machine over remote access, for the status bar; omitted where remote access does not exist. */
  remoteClients?: RemoteClientsFeed
  /** Remembers a plugin the user's own answer switched off (a declined consent). */
  persistPluginEnabled?: (pluginId: string, enabled: boolean) => void
  /** After an index pass that changed something, so a search typed mid-pass can re-query. */
  onIndexUpdated?: () => void
  /** Defaults to `ClaudeProjectsSource` built from `configRoot`. */
  source?: SessionSource
  /**
   * Injectable collaborators, defaulting to the real ones. Supplied `plugins` and `statusBar` are
   * used as-is: the built-in plugins are not registered into them.
   */
  deps?: {
    pty?: PtyManager
    store?: SessionStore
    plugins?: PluginRegistry
    statusBar?: StatusBarRegistry
  }
}

export interface Services {
  service: AppService
  source: SessionSource
  /** What each open tab is doing, for the Active section. */
  activeTabs: ActiveTabsService
  /** The remote server asks it where a session's folder or a mentioned file is. */
  vscode: VsCodeService
  /** The session database, shared with the account service for `session_account`. */
  store: SessionStore
  /** The Claude accounts; the terminals, the chats and the one-shot calls launch under them. */
  accounts: AccountService
}

/**
 * Builds the session-side services and wires them together. Nothing starts here, so a test builds
 * the graph around a temp directory with `createServices({ configRoot, dbPath })`.
 */
export function createServices(options: ServicesOptions): Services {
  const source = options.source ?? new ClaudeProjectsSource(options.configRoot)
  const pty = options.deps?.pty ?? new PtyManager()
  const store = options.deps?.store ?? new SessionStore(options.dbPath)
  const disposed = new DisposedFlag()
  const dataDir = dirname(options.dbPath)
  const resolver = new SessionResolver({ store, pty })
  const worktrees = new WorktreeResolver({ exec: createResolverExec() })
  const vscode = new VsCodeService({ resolver, vsCodePath: options.vsCodePath ?? null })
  const images = new ImageStore({ dir: options.imagesDir ?? join(dataDir, 'pasted-images') })
  const searchDbPath = options.searchDbPath ?? join(dataDir, 'search.db')
  const search = new SearchService({
    store,
    createIndex: () => new SearchIndex(searchDbPath),
    createClient: () => new SearchClient(searchDbPath),
    searchChatContent: options.searchChatContent,
    searchSessionNotes: options.searchSessionNotes,
    onIndexUpdated: options.onIndexUpdated,
    isDisposed: () => disposed.disposed,
  })
  const homeDir = options.homeDir
  const accounts = new AccountService({
    mainRoot: options.configRoot, accountsDir: options.accountsDir ?? join(dataDir, 'accounts'), homeDir,
    store: createAccountsStore(options.accountsFile ?? join(dataDir, 'accounts.json')),
    sessions: { get: (id) => store.getSessionAccount(id), set: (id, accountId) => { store.setSessionAccount(id, accountId) } },
    ...(options.accountsOutside ?? { exec: createExec({ scope: 'accounts' }), platform: process.platform }),
  })
  accounts.onChanged(() => { options.onAccountsChanged?.() })
  const terminals = new TerminalService({
    pty, resolver, store, worktrees, accounts, homeDir,
    claudeBin: options.claudeBin,
    promptPath: options.promptPath,
    zshPromptShim: options.zshPromptShim,
  })
  const catalog = new SessionCatalog({
    store, source, worktrees,
    detectLive: options.detectLive,
    onLiveChanged: options.onLiveChanged,
    autoImportAll: options.autoImportAll,
    isDisposed: () => disposed.disposed,
    updateSearchIndex: () => search.update(),
    afterRefresh: () => { chat.adoptSessions() },
  })
  const git = new GitService({
    resolver,
    glabPath: options.glabPath,
    branchOps: new BranchOps({ exec: createBranchExec() }),
    mrStatus: new MrStatusCache({ exec: createMrExec() }),
    refreshProject: (cwd) => catalog.refreshProject(cwd),
    startSessionIn: (folder) => terminals.newSessionInFolder(folder),
  })
  const actions = new SessionActions({ store, source, resolver, catalog, search, pty, worktrees })
  const transcripts = new TranscriptService({
    resolver, store, reader: new TranscriptReader(), readFrom: forEachMessageFrom, taskOutputRoots: claudeTaskRoots(source.watchDir),
  })
  const chats: ChatManager = new ChatManager({
    claudeBin: () => terminals.getClaudeBin() ?? undefined,
    accounts,
    onChange: (state) => { chat.onChanged(state) },
    spawn: options.chatSpawn,
  })
  const chat: ChatService = new ChatService({
    chats, pty, resolver, store, terminals, catalog, transcripts, accounts, aside: () => new ClaudeOneShot({ claudeBin: () => terminals.getClaudeBin() }),
    sessionAccountsChanged: () => { options.onSessionAccountsChanged?.() },
    configRoot: options.configRoot,
    attachments: options.chat?.attachments ?? new WindowAttachments(() => null),
    announce: options.chat?.announce ?? (() => {}),
    activityChanged: options.chat?.activityChanged ?? (() => {}),
  })
  const plugins = new PluginService({
    plugins: options.deps?.plugins ?? new PluginRegistry({ onChanged: () => options.onPluginsChanged?.() }),
    statusBar: options.deps?.statusBar ?? new StatusBarRegistry({ onChanged: () => options.onStatusBarChanged?.() }),
    resolver,
    git,
    ...(options.deps?.plugins === undefined && options.deps?.statusBar === undefined
      ? {
        builtins: {
          enabled: options.plugins,
          settings: options.pluginSettings,
          glabPath: options.glabPath,
          configRoot: options.configRoot,
          useKeychain: options.statusBarKeychain ?? false, accounts, fakeUsage: options.fakeUsage,
          consent: options.claudeUsageConsent,
          remoteClients: options.remoteClients,
          persistEnabled: options.persistPluginEnabled,
        },
      }
      : {}),
  })
  const activeTabs = new ActiveTabsService({
    tabs: options.tabs ?? { list: () => [] },
    pty,
    chats: chat,
    transcripts,
    now: () => Date.now(),
  })
  const service = new AppService({
    pty, store, git, vscode, images, search, terminals, catalog, actions, transcripts, chat, plugins, disposed,
  })
  return { service, source, activeTabs, vscode, store, accounts }
}

export function createContainer(env: RuntimeEnv, paths: ContainerPaths, inputs: ContainerInputs): Container {
  const sessionLayoutStore = createSessionLayoutStore(paths.sessionLayoutFile)
  const layoutFlushCoordinator = createLayoutFlushCoordinator()
  const tabRegistry = new TabRegistry()
  const settingsService = new SettingsService(paths.settingsFile)
  const windowManager = new WindowManager({
    settingsService, sessionLayoutStore, tabRegistry, headless: env.headless,
    dirname: inputs.dirname, rendererUrl: env.rendererUrl, isQuitting: inputs.isQuitting,
    ...(env.windowChrome !== undefined ? { chromeOverride: env.windowChrome } : {}),
    ...(env.rendererSeams !== undefined ? { rendererSeams: env.rendererSeams } : {}),
    ...(env.closeGraceMs !== undefined ? { closeGraceMs: env.closeGraceMs } : {}),
  })
  const settings = settingsService.get()
  const fakeLive = env.fakeLive
  const { virtualContents, remotePairing, remoteServer, useVsCode } = createRemoteServing({
    homeDir: inputs.homeDir, host: inputs.host, appVersion: inputs.appVersion, pairingFile: paths.remotePairingFile,
    settings: settingsService, layouts: () => sessionLayoutStore.snapshot().windows,
  })
  const { service, source, activeTabs, vscode, accounts } = createServices({
    remoteClients: remoteServer, configRoot: paths.configRoot, dbPath: paths.dbPath, claudeBin: settings.claudeBin ?? undefined,
    accountsFile: paths.accountsFile, accountsDir: paths.accountsDir, homeDir: inputs.homeDir,
    onAccountsChanged: () => { broadcast(IPC.accountsChanged, accounts.list()) },
    onSessionAccountsChanged: () => { broadcast(IPC.sessionAccountsChanged, service.chat.liveSessionAccounts()) },
    autoImportAll: settings.autoImportAll,
    searchChatContent: settings.searchChatContent, searchSessionNotes: settings.searchSessionNotes,
    promptPath: {
      enabled: settings.terminalShortenPath, segments: settings.terminalPathSegments, minimal: settings.terminalMinimalPrompt,
    },
    zshPromptShim: inputs.zshPromptShim,
    plugins: settings.plugins,
    pluginSettings: settings.pluginSettings,
    // Test-only, like APIARY_FAKE_LIVE: points the merge-request plugin at a stand-in `glab`.
    glabPath: env.glabPath === '' ? undefined : env.glabPath,
    vsCodePath: inputs.vsCodePath,
    onPluginsChanged: () => { broadcast(IPC.pluginsChanged) },
    onStatusBarChanged: () => { broadcast(IPC.statusBarChanged) },
    tabs: tabRegistry,
    chat: {
      attachments: new WindowAttachments((id) => webContents.fromId(id) ?? virtualContents.get(id)),
      announce: (change) => { broadcast(IPC.chatLifecycle, change) },
      activityChanged: () => { broadcast(IPC.activeTabsChanged) },
    },
    statusBarKeychain: inputs.statusBarKeychain, fakeUsage: env.fakeUsage,
    claudeUsageConsent: {
      load: () => settingsService.get().claudeUsageConsent,
      save: (state) => { settingsService.patch({ claudeUsageConsent: state }) },
    },
    persistPluginEnabled: (pluginId, enabled) => {
      settingsService.patch({ plugins: { ...settingsService.get().plugins, [pluginId]: enabled } })
    },
    onIndexUpdated: () => { broadcast(IPC.treeChanged) },
    onLiveChanged: () => { broadcast(IPC.treeChanged) },
    detectLive: fakeLive !== undefined && fakeLive !== ''
      ? async () => new Map([[fakeLive, 4242]])
      : undefined,
  })
  const sessionWatcher = new SessionWatcher({
    dir: source.watchDir,
    onChange: (changed) => {
      // A background task starting or finishing writes the session file while its terminal may be quiet.
      broadcast(IPC.activeTabsChanged)
      fireAndForget(service.refresh({ paths: changed }).then(() => { broadcast(IPC.treeChanged) }), 'watcher')
    },
  })
  const ipcState = createIpcState({
    pty: service.pty, configRoot: paths.configRoot, tabRegistry, virtualContents, accounts,
    openDetachedWindow: (tab, at) => windowManager.create({ detach: tab, at }),
    windowNumberFor: (id) => windowManager.windowNumberFor(id),
  })
  useVsCode(vscode)
  const { remoteWindows, hostDirectory, remoteClient } = createRemoteConnecting({
    homeDir: inputs.homeDir, host: inputs.host, appVersion: inputs.appVersion, vsCodePath: inputs.vsCodePath,
    sshConfig: env.sshConfig, hostsFile: paths.remoteHostsFile, pairingCodesFile: paths.remotePairingCodesFile, windowManager,
  }, realConnectingOutside(inputs.host))
  const updater = createUpdater(settingsService, env, inputs.macSigned)
  // One runner per kind of call, over whichever `claude` is configured at the time it runs.
  const makeRunner = (): ClaudeOneShot => new ClaudeOneShot({ claudeBin: () => service.claudeBin, env: () => accounts.defaultEnv() })
  const themeGenerator = new ThemeGenerator({ runner: makeRunner() })
  // APIARY_DEFAULT_THEME=original is test-only: the E2E suite is written against that look.
  const themeStore = new ThemeStore(paths.themesFile, env.defaultThemeOriginal ? null : DEFAULT_THEME_ID)
  const petStore = new PetStore(paths.petsFile)
  const petsChanged = (): void => { broadcast(IPC.petsChanged, petService.state()) }
  const petService: PetService = new PetService({ store: petStore, makeRunner, onChanged: petsChanged })
  const petPlacement = new PetPlacement({
    store: petStore, ...petWindowing(windowManager, ipcState.tabMover), arrive: (arrival) => { petService.arrive(arrival) }, changed: petsChanged,
  })
  windowManager.onWindowClosed((number, quitting) => { petPlacement.windowClosed(number, { quitting }) })
  const spelling = new SpellingService()
  const folderBrowser = new FolderBrowser({ home: inputs.homeDir })
  const library = new LibraryStateService({
    file: paths.libraryStateFile,
    moved: settingsService.movedToLibrary(),
    onChanged: (snapshot) => { broadcast(IPC.libraryStateChanged, snapshot) },
  })
  return {
    paths, settingsService, sessionLayoutStore, layoutFlushCoordinator, tabRegistry,
    windowManager, service, chat: service.chat, plugins: service.plugins, spelling, folderBrowser, ipcState, sessionWatcher, updater,
    themeStore, themeGenerator, petStore, petService, petPlacement, activeTabs, remoteServer, remotePairing, virtualContents, remoteWindows, remoteClient, hostDirectory,
    library, accounts,
  }
}
