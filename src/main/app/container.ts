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
import { TranscriptReader } from '../transcript/transcriptReader'
import { WorktreeResolver, createResolverExec } from '../git/worktreeResolver'
import { BranchOps, createBranchExec } from '../git/branchOps'
import { MrStatusCache, createMrExec } from '../git/mrStatusCache'
import { GitService } from '../git/gitService'
import { SearchIndex } from '../search/searchIndex'
import { SearchClient } from '../search/searchClient'
import { SearchService } from '../search/searchService'
import { TerminalService } from '../terminals/terminalService'
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
import { createUpdater } from '../update/createUpdater'
import type { UpdateService } from '../update/updateService'
import { broadcast } from '../windows/broadcast'
import { WindowAttachments } from '../windows/windowAttachments'
import { IPC } from '@shared/api'
import type { RuntimeEnv } from './env'

/**
 * The explicit composition root (MAIN-15 step 5): the one place that lists every long-lived
 * main-process object and what each is built from.
 *
 * Construction only. Nothing here opens a window, starts a timer, polls, refreshes, registers an
 * IPC handler or touches `electron`'s `app`: whatever needs Electron (paths, `isPackaged`, the
 * zsh shim written to disk, VS Code detection, the dock) is resolved by `index.ts` and passed in,
 * which is also what lets a unit test build the whole graph. (`SettingsService`'s constructor
 * does read and migrate `settings.json` — that is its documented contract, MAIN-16.)
 *
 * What stays outside, deliberately: `registerIpc` (it needs the dialog-backed `pickFolder` and the
 * auto-import timer from `index.ts`), starting the updater and status bar (after the first window),
 * and shutdown ordering (`index.ts`'s `shutdown`), none of which are construction.
 */
export interface ContainerPaths {
  configRoot: string
  dbPath: string
  settingsFile: string
  sessionLayoutFile: string
  themesFile: string
  petsFile: string
}

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
}

/** How often, at most, the Active section's activity broadcast goes out while a pty is producing
 *  output. See `ActivityBroadcaster`. */
const ACTIVITY_BROADCAST_MS = 500

export interface IpcStateInputs {
  pty: PtyManager
  configRoot: string
  tabRegistry: TabRegistry | null
  /** Opens a tab in a window of its own, resolving the new window's number. */
  openDetachedWindow: (tab: TabTransfer, at: { x: number; y: number }) => number
  windowNumberFor: (webContentsId: number) => number | null
}

export function createIpcState(inputs: IpcStateInputs): IpcState {
  const ptyAttachments = new WindowAttachments((wcId) => webContents.fromId(wcId) ?? null)
  return {
    sessionTracker: new ClaudeSessionTracker({
      sessionsDir: join(inputs.configRoot, 'sessions'),
      pids: () => inputs.pty.tuiPids(),
      onChange: (sessions) => {
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
  /** What the IPC handlers share between channels (`registerIpc` takes it). */
  ipcState: IpcState
  /** New session files appear without a restart; `index.ts` starts it before the first refresh. */
  sessionWatcher: SessionWatcher
  updater: UpdateService | null
  themeStore: ThemeStore
  themeGenerator: ThemeGenerator
  petStore: PetStore
  petService: PetService
}

/**
 * What the session-side services are built from (formerly `AppServiceOptions`). Plain data and a
 * few callbacks; every optional field has the default the app wants, so a test names only what it
 * cares about.
 */
export interface ServicesOptions {
  configRoot: string
  dbPath: string
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
  /** Which windows show which chat, and how every window hears a chat started, moved or ended
   *  (see `ChatService`). Defaults to no windows. */
  chat?: { attachments: WindowAttachments; announce: (change: ChatLifecycle) => void }
  /** Test-only: starts chat processes instead of a login shell running `claude`. */
  chatSpawn?: SpawnChat
  /** Let the Claude usage plugin read the macOS Keychain: only against the real `~/.claude`,
   *  never a test fixture's, since a Keychain read can put a permission prompt on screen. */
  statusBarKeychain?: boolean
  /** Where the answer to the usage plugin's consent prompt is kept. Omitted: in memory only, so
   *  a test (or a caller that persists nothing) is asked, and reads nothing, until it answers. */
  claudeUsageConsent?: ConsentStorage
  /** Remembers a plugin the user's own answer switched off (a declined consent). */
  persistPluginEnabled?: (pluginId: string, enabled: boolean) => void
  /**
   * Called after an index pass that actually changed something. Indexing runs behind whatever the
   * user is doing, so a search typed while it was still running would otherwise sit on results
   * that were incomplete at the moment they were fetched, with nothing to prompt a re-query.
   */
  onIndexUpdated?: () => void
  /** Where sessions come from (MAIN-18). Defaults to `ClaudeProjectsSource`, built from
   *  `configRoot` — the only source that exists today, and built here exactly once. */
  source?: SessionSource
  /**
   * Injectable collaborators (TEST-6 / MAIN-14 step 1). Each defaults to today's construction, so a
   * test can pass a fake `pty` or `store` instead of getting a real node-pty process or a real
   * SQLite file. `plugins` and `statusBar`, if supplied, are used as-is — the built-in plugins are
   * then not registered, since a caller handing in a whole registry has already decided what is in it.
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
}

/**
 * Builds the session-side services and wires them to one another: the one place their
 * collaborators are chosen. No window, timer or refresh starts here (`AppService.startStatusBar`
 * and the watcher are started by `index.ts`), so a test builds the whole graph around a temp
 * directory with `createServices({ configRoot, dbPath })`.
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
  const terminals = new TerminalService({
    pty, resolver, store, worktrees,
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
  const transcripts = new TranscriptService({ resolver, store, reader: new TranscriptReader() })
  const chats: ChatManager = new ChatManager({
    claudeBin: () => terminals.getClaudeBin() ?? undefined,
    onChange: (state) => { chat.onChanged(state) },
    spawn: options.chatSpawn,
  })
  const chat: ChatService = new ChatService({
    chats, pty, resolver, store, terminals, catalog, transcripts,
    configRoot: options.configRoot,
    attachments: options.chat?.attachments ?? new WindowAttachments(() => null),
    announce: options.chat?.announce ?? (() => {}),
  })
  const plugins = new PluginService({
    plugins: options.deps?.plugins ?? new PluginRegistry({ onChanged: () => options.onPluginsChanged?.() }),
    statusBar: options.deps?.statusBar ?? new StatusBarRegistry({ onChanged: () => options.onStatusBarChanged?.() }),
    resolver,
    git,
    // A caller that injected its own registries decided what is in them, so the built-ins are not
    // added on top.
    ...(options.deps?.plugins === undefined && options.deps?.statusBar === undefined
      ? {
        builtins: {
          enabled: options.plugins,
          settings: options.pluginSettings,
          glabPath: options.glabPath,
          configRoot: options.configRoot,
          useKeychain: options.statusBarKeychain ?? false,
          consent: options.claudeUsageConsent,
          persistEnabled: options.persistPluginEnabled,
        },
      }
      : {}),
  })
  const service = new AppService({
    pty, store, git, vscode, images, search, terminals, catalog, actions, transcripts, chat, plugins, disposed,
  })
  return { service, source }
}

export function createContainer(env: RuntimeEnv, paths: ContainerPaths, inputs: ContainerInputs): Container {
  const sessionLayoutStore = createSessionLayoutStore(paths.sessionLayoutFile)
  const layoutFlushCoordinator = createLayoutFlushCoordinator()
  const tabRegistry = new TabRegistry()
  // Reads the file once, migrates it and writes the migration back — see `SettingsService`'s own
  // doc comment (MAIN-16). Every later read/write in this process goes through this one instance.
  const settingsService = new SettingsService(paths.settingsFile)
  const windowManager = new WindowManager({
    settingsService,
    sessionLayoutStore,
    tabRegistry,
    headless: env.headless,
    dirname: inputs.dirname,
    rendererUrl: env.rendererUrl,
    isQuitting: inputs.isQuitting,
    ...(env.windowChrome !== undefined ? { chromeOverride: env.windowChrome } : {}),
    ...(env.rendererSeams !== undefined ? { rendererSeams: env.rendererSeams } : {}),
  })
  const settings = settingsService.get()
  const fakeLive = env.fakeLive
  const { service, source } = createServices({
    configRoot: paths.configRoot,
    dbPath: paths.dbPath,
    claudeBin: settings.claudeBin ?? undefined,
    autoImportAll: settings.autoImportAll,
    searchChatContent: settings.searchChatContent,
    searchSessionNotes: settings.searchSessionNotes,
    promptPath: {
      enabled: settings.terminalShortenPath,
      segments: settings.terminalPathSegments,
      minimal: settings.terminalMinimalPrompt,
    },
    zshPromptShim: inputs.zshPromptShim,
    plugins: settings.plugins,
    pluginSettings: settings.pluginSettings,
    // Test-only, like APIARY_FAKE_LIVE: points the merge-request plugin at a stand-in `glab`.
    glabPath: env.glabPath === '' ? undefined : env.glabPath,
    vsCodePath: inputs.vsCodePath,
    onPluginsChanged: () => { broadcast(IPC.pluginsChanged) },
    onStatusBarChanged: () => { broadcast(IPC.statusBarChanged) },
    chat: {
      attachments: new WindowAttachments((id) => webContents.fromId(id) ?? null),
      announce: (change) => { broadcast(IPC.chatLifecycle, change) },
    },
    statusBarKeychain: inputs.statusBarKeychain,
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
  // New session files appear without a restart, debounced into scoped refresh requests (MAIN-1) —
  // see `SessionWatcher` for the depth/ignore rationale (MAIN-25). Built here, started by `index.ts`.
  const sessionWatcher = new SessionWatcher({
    dir: source.watchDir,
    onChange: (changed) => {
      fireAndForget(service.refresh({ paths: changed }).then(() => { broadcast(IPC.treeChanged) }), 'watcher')
    },
  })
  const ipcState = createIpcState({
    pty: service.pty,
    configRoot: paths.configRoot,
    tabRegistry,
    openDetachedWindow: (tab, at) => windowManager.create({ detach: tab, at }),
    windowNumberFor: (id) => windowManager.windowNumberFor(id),
  })
  const updater = createUpdater(settingsService, env, inputs.macSigned)
  // One runner per kind of call, over whichever `claude` is configured at the time it runs.
  const makeRunner = (): ClaudeOneShot => new ClaudeOneShot({ claudeBin: () => service.claudeBin })
  const themeGenerator = new ThemeGenerator({ runner: makeRunner() })
  // APIARY_DEFAULT_THEME=original is test-only: the E2E suite is written against the original
  // look, so a fresh profile there starts on it rather than on the default theme.
  const themeStore = new ThemeStore(paths.themesFile, env.defaultThemeOriginal ? null : DEFAULT_THEME_ID)
  const petStore = new PetStore(paths.petsFile)
  const petService: PetService = new PetService({
    store: petStore,
    makeRunner,
    onChanged: () => { broadcast(IPC.petsChanged, petService.state()) },
  })
  return {
    paths, settingsService, sessionLayoutStore, layoutFlushCoordinator, tabRegistry,
    windowManager, service, chat: service.chat, plugins: service.plugins, ipcState, sessionWatcher, updater,
    themeStore, themeGenerator, petStore, petService,
  }
}

/** The on-disk locations that sit beside `userData`, in one place. */
export function containerPaths(
  env: RuntimeEnv, userData: string, defaultConfigRoot: () => string,
): ContainerPaths {
  return {
    configRoot: env.configRoot ?? defaultConfigRoot(),
    dbPath: env.dbPath ?? join(userData, 'apiary.db'),
    settingsFile: join(userData, 'settings.json'),
    sessionLayoutFile: join(userData, 'session-layout.json'),
    themesFile: join(userData, 'themes.json'),
    petsFile: join(userData, 'pets.json'),
  }
}
