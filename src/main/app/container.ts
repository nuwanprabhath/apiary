import { webContents } from 'electron'
import { type AppService } from '../appService'
import { PtyManager, type LinkHelper } from '../pty/ptyManager'
import { SessionWatcher } from '../sessions/sessionWatcher'
import { type ActiveTabsService } from '../terminals/activeTabsService'
import { type ChatService } from '../chat/chatService'
import { ClaudeOneShot } from '../claude/claudeOneShot'
import { type KnowledgeParts } from './knowledgeContainer'
import { type PluginService } from '../plugins/pluginService'
import { treeChangeOfPaths } from '@shared/domain/session'
import { fireAndForget } from '../log/fireAndForget'
import { closeGraceMs } from '../windows/closeGrace'
import type { IpcState } from '../ipc/ipcState'
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
import type { RemoteWindows } from '../remote/remoteWindows'
import type { RemoteClientService } from '../remote/remoteClientService'
import type { HostDirectory } from '../remote/hostDirectory'
import { createRemoteConnecting, createRemoteServing, realConnectingOutside } from './remoteContainer'
import { createDriving } from './drivingContainer'
import { createResidents } from './residentsContainer'
import { createAppPrivacy,  type PrivacyParts } from './privacyContainer'
import { withPrivacyTargets } from './privacyTargetsContainer'
import { createAppSlack } from './slackContainer'
import { createSchedules, osJobsWanted, type ScheduleParts } from './scheduleContainer'
import type { VirtualContentsRegistry } from '../remote/virtualContents'
import { IPC } from '@shared/api'
import type { RuntimeEnv } from './env'
import { SpellingService } from '../spelling/spellingService'
import { FolderBrowser } from '../folders/folderBrowser'
import { LibraryStateService } from '../library/libraryStateService'
import { type AccountService } from '../accounts/accountService'
import type { ContainerPaths } from './containerPaths'
import { createServices } from './servicesContainer'
import { createIpcState } from './ipcStateContainer'

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
  /** `writeLinkHelper(...)`'s script and this run's token (`$BROWSER` in every pty): a file write, so done by the caller. */
  linkHelper: LinkHelper
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
  resourcesDir: string
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
  knowledge: KnowledgeParts
  accounts: AccountService
  /** The privacy gate and the service behind the privacy IPC. */
  privacy: PrivacyParts
  /** The resident agents; `index.ts` starts them once windows can hear them, and disposes of them on quit. */
  residents: ReturnType<typeof createResidents>
  /** Scheduled messages, session driving and Slack: `index.ts` starts them once windows can hear them. */
  schedules: ScheduleParts
  driving: ReturnType<typeof createDriving>
  slack: ReturnType<typeof createAppSlack>
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
  const { privacy, usageConsent } = createAppPrivacy(settingsService)
  const privacyGate = privacy.gate
  const fakeLive = env.fakeLive
  const { virtualContents, remotePairing, remoteServer, useVsCode } = createRemoteServing({
    homeDir: inputs.homeDir, host: inputs.host, appVersion: inputs.appVersion, pairingFile: paths.remotePairingFile,
    settings: settingsService, layouts: () => sessionLayoutStore.snapshot().windows, openWindows: () => windowManager.openNumbers(),
  })
  const { service, source, activeTabs, vscode, accounts, knowledge, store, git, catalog } = createServices({
    remoteClients: remoteServer, configRoot: paths.configRoot, dbPath: paths.dbPath, claudeBin: settings.claudeBin ?? undefined,
    accountsFile: paths.accountsFile, accountsDir: paths.accountsDir, homeDir: inputs.homeDir, knowledge: paths,
    onAccountsChanged: () => { broadcast(IPC.accountsChanged, accounts.list()) },
    onSessionAccountsChanged: () => { broadcast(IPC.sessionAccountsChanged, service.chat.liveSessionAccounts()) },
    autoImportAll: settings.autoImportAll, searchChatContent: settings.searchChatContent, searchSessionNotes: settings.searchSessionNotes,
    promptPath: { enabled: settings.terminalShortenPath, segments: settings.terminalPathSegments, minimal: settings.terminalMinimalPrompt },
    zshPromptShim: inputs.zshPromptShim, deps: { pty: new PtyManager(undefined, inputs.linkHelper) },
    plugins: settings.plugins,
    pluginSettings: settings.pluginSettings,
    // Test-only, like APIARY_FAKE_LIVE: points the merge-request plugin at a stand-in `glab`.
    glabPath: env.glabPath === '' ? undefined : env.glabPath,
    vsCodePath: inputs.vsCodePath, onPluginsChanged: () => { broadcast(IPC.pluginsChanged) }, onStatusBarChanged: () => { broadcast(IPC.statusBarChanged) },
    tabs: tabRegistry,
    chat: {
      attachments: new WindowAttachments((id) => webContents.fromId(id) ?? virtualContents.get(id)),
      announce: (change) => { broadcast(IPC.chatLifecycle, change) }, activityChanged: () => { broadcast(IPC.activeTabsChanged) },
    },
    statusBarKeychain: inputs.statusBarKeychain, fakeUsage: env.fakeUsage,
    claudeUsageConsent: usageConsent, privacyGate,
    persistPluginEnabled: (pluginId, enabled) => { settingsService.patch({ plugins: { ...settingsService.get().plugins, [pluginId]: enabled } }) },
    onIndexUpdated: () => { broadcast(IPC.treeChanged, { sessions: null }) }, onLiveChanged: () => { broadcast(IPC.treeChanged, { sessions: null }) },
    detectLive: fakeLive !== undefined && fakeLive !== '' ? async () => new Map([[fakeLive, 4242]]) : undefined,
  })
  const sessionWatcher = new SessionWatcher({
    dir: source.watchDir,
    onChange: (changed) => {
      // A background task starting or finishing writes the session file while its terminal may be quiet.
      broadcast(IPC.activeTabsChanged)
      fireAndForget(service.refresh({ paths: changed }).then(() => { broadcast(IPC.treeChanged, treeChangeOfPaths(changed)) }), 'watcher')
    },
  })
  const ipcState = createIpcState({
    pty: service.pty, configRoot: paths.configRoot, tabRegistry, virtualContents, accounts,
    openDetachedWindow: (tab, at) => windowManager.create({ detach: tab, at }),
    windowNumberFor: (id) => windowManager.windowNumberFor(id),
  })
  useVsCode(vscode, service.pty)
  const { remoteWindows, hostDirectory, remoteClient } = createRemoteConnecting({
    homeDir: inputs.homeDir, host: inputs.host, appVersion: inputs.appVersion, vsCodePath: inputs.vsCodePath,
    sshConfig: env.sshConfig, tailscalePath: env.tailscalePath, hostsFile: paths.remoteHostsFile, pairingCodesFile: paths.remotePairingCodesFile, windowManager,
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
    store: petStore,
    ...petWindowing(windowManager, ipcState.tabMover),
    arrive: (arrival) => { petService.arrive(arrival) },
    changed: petsChanged,
    graceMs: env.closeGraceMs ?? closeGraceMs(process.platform),
  })
  windowManager.onWindowClosed((number, quitting) => { petPlacement.windowClosed(number, { quitting }) })
  const spelling = new SpellingService({ privacyGate })
  const folderBrowser = new FolderBrowser({ home: inputs.homeDir })
  const library = new LibraryStateService({
    file: paths.libraryStateFile, moved: settingsService.movedToLibrary(), onChanged: (snapshot) => { broadcast(IPC.libraryStateChanged, snapshot) },
  })
  const residents = createResidents({
    settingsService, paths, store, accounts, knowledge, tabRegistry, service, ipcState, windowManager, virtualContents,
    version: inputs.appVersion, resourcesDir: inputs.resourcesDir, privacyGate,
  })
  const driving = createDriving({ store, chat: service.chat, git, catalog, tabMover: ipcState.tabMover, virtualContents })
  const schedules = createSchedules({
    paths, os: osJobsWanted(env) ? { homeDir: inputs.homeDir } : null, store, accounts, chat: service.chat, service,
    model: env.scheduleModel,
  })
  const slack = createAppSlack(paths, env, privacyGate)
  return withPrivacyTargets({
    paths, settingsService, sessionLayoutStore, layoutFlushCoordinator, tabRegistry, windowManager, service,
    chat: service.chat, plugins: service.plugins, spelling, folderBrowser, ipcState, sessionWatcher, updater,
    themeStore, themeGenerator, petStore, petService, petPlacement, activeTabs, remoteServer, remotePairing,
    virtualContents, remoteWindows, remoteClient, hostDirectory, library, accounts, knowledge, privacy,
    residents, driving, schedules, slack,
  }, store)
}
