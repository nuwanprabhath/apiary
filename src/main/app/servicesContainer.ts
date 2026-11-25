import { dirname, join } from 'node:path'
import { AppService, DisposedFlag } from '../appService'
import { ClaudeProjectsSource, type SessionSource } from '../sources/claudeProjects'
import { SessionStore } from '../store/sessionStore'
import { PtyManager } from '../pty/ptyManager'
import type { PromptPathOptions } from '../pty/promptPath'
import { SessionResolver } from '../sessions/sessionResolver'
import { SessionCatalog } from '../sessions/sessionCatalog'
import { SessionActions } from '../sessions/sessionActions'
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
import { createKnowledge, type KnowledgeParts, type KnowledgePaths } from './knowledgeContainer'
import { PluginRegistry } from '../plugins/registry'
import { PluginService } from '../plugins/pluginService'
import { StatusBarRegistry } from '../statusBar/registry'
import type { ChatLifecycle } from '@shared/domain/chat'
import type { PluginSettingValues } from '@shared/domain/plugins'
import { ptysOnSession } from '../claude/trackerAccounts'
import { type TabRegistry } from '../windows/tabRegistry'
import { WindowAttachments } from '../windows/windowAttachments'
import type { RemoteClientsFeed } from '../statusBar/remoteClients'
import { type ConsentStorage, type PrivacyGate } from './privacyContainer'
import { AccountService, createAccountsStore } from '../accounts/accountService'
import { createExec, type ExecFn } from '../exec/run'

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
  knowledge?: KnowledgePaths
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
  /** Which windows show which chat, how every window hears a chat start, move, end or change activity (see `ChatService`). Defaults to no windows. */
  chat?: { attachments: WindowAttachments; announce: (change: ChatLifecycle) => void; activityChanged: () => void }
  /** The open tabs the Active section reads. Defaults to none, so a test that shows no tabs needs no registry. */
  tabs?: Pick<TabRegistry, 'list'>
  /** Test-only: starts chat processes instead of a login shell running `claude`. */
  chatSpawn?: SpawnChat
  /** Let the Claude usage plugin read the macOS Keychain: only against the real `~/.claude`,
   *  never a test fixture's, since a Keychain read can put a permission prompt on screen. */
  statusBarKeychain?: boolean
  /** Test-only (`APIARY_FAKE_USAGE`): the JSON the usage plugin shows in place of the sign-in and the usage endpoint. */
  fakeUsage?: string
  /** Where the usage plugin's consent answer is kept. Omitted: in memory only, so a test is asked, and reads nothing, until it answers. */
  claudeUsageConsent?: ConsentStorage
  /** What the background features ask before they send anything (`privacy/privacyGate.ts`). Omitted in a test that builds no settings. */
  privacyGate?: PrivacyGate
  /** Who is connected to this machine over remote access, for the status bar; omitted where remote access does not exist. */
  remoteClients?: RemoteClientsFeed
  /** Remembers a plugin the user's own answer switched off (a declined consent). */
  persistPluginEnabled?: (pluginId: string, enabled: boolean) => void
  /** After an index pass that changed something, so a search typed mid-pass can re-query. */
  onIndexUpdated?: (sessionIds: string[]) => void
  /** Defaults to `ClaudeProjectsSource` built from `configRoot`. */
  source?: SessionSource
  /** Injectable collaborators, defaulting to the real ones. Supplied `plugins` and `statusBar` are used as-is: the built-in plugins are not registered into them. */
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
  knowledge: KnowledgeParts
  /** What the session driver creates worktrees and asks for scans through. */
  git: GitService
  catalog: SessionCatalog
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
  const vscode = new VsCodeService({ resolver, vsCodePath: options.vsCodePath ?? null, homeDir: options.homeDir })
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
    updateSearchIndex: (scope) => search.update(scope),
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
  const actions = new SessionActions({ store, source, resolver, catalog, search, pty, worktrees, forgetDerived: async (id) => { await search.forget(id); knowledge.store.forget(id) } })
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
    configRoot: options.configRoot, terminalsOn: (sessionId) => ptysOnSession(pty, options.configRoot, accounts, sessionId),
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
          consent: options.claudeUsageConsent, privacyGate: options.privacyGate, remoteClients: options.remoteClients,
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
  const knowledge = createKnowledge({ ...options.knowledge, dataDir, store, search, accounts, claudeBin: () => terminals.getClaudeBin(), privacyGate: options.privacyGate })
  return { service, source, activeTabs, vscode, store, accounts, knowledge, git, catalog }
}
