import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ClaudeProjectsSource, type SessionSource } from './sources/claudeProjects'
import { SessionStore } from './store/sessionStore'
import { indexTranscript, readTranscriptPage } from './transcript/transcriptReader'
import { PtyManager } from './pty/ptyManager'
import { SessionResolver } from './sessions/sessionResolver'
import { SessionCatalog } from './sessions/sessionCatalog'
import { SessionActions } from './sessions/sessionActions'
import { GitService } from './git/gitService'
import { SearchService } from './search/searchService'
import type { PromptPathOptions } from './pty/promptPath'
import { TerminalService } from './terminals/terminalService'
import { PluginRegistry } from './plugins/registry'
import { BUILTIN_PLUGINS } from './plugins/builtin'
import { StatusBarRegistry } from './statusBar/registry'
import { BUILTIN_STATUS_BAR_PLUGINS } from './statusBar/builtin'
import type { PluginBarItem } from './plugins/types'
import type { PtyId, SessionId, TerminalRef } from '@shared/domain/ids'
import type { MrState } from './git/mrStatusCache'
import { VsCodeService } from './vscode/vscodeService'
import { ChatManager, type SpawnChat } from './chat/chatManager'
import type { ChatDecision, ChatEffort, ChatModel, ChatPermissionMode, ChatState, TerminalBusy } from '@shared/domain/chat'
import { classifyActivity } from '@shared/activity'
import { runningBackgroundTasks } from '@shared/chatTimeline'
import { latestAction } from '@shared/pets/actions'
import { ImageStore } from './media/imageStore'
import type {
  ProjectNode, ResumeConflict, TranscriptPage, NewSessionInfo, CheckoutOutcome,
} from '@shared/types'
import type { StoredSession } from './store/sessionStore'
import type { GitStatus, GitRefs, FolderWorktree } from '@shared/types'
import type { WorktreeCreateOptions, WorktreeCreateRequest } from '@shared/domain/git'

export interface AppServiceOptions {
  configRoot: string
  dbPath: string
  detectLive?: () => Promise<Map<string, number>>
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
  pluginSettings?: Record<string, Record<string, string | number | boolean>>
  /** Path to the `glab` executable, for anyone whose install is not on PATH (and for tests). */
  glabPath?: string
  /** Path to the `code` CLI, resolved once at startup by `detectVsCode`. Null when none was found. */
  vsCodePath?: string | null
  /** Called when a plugin's contribution to a bar changed, so windows can re-read it. */
  onPluginsChanged?: () => void
  /** The status bar's items changed (a usage poll landed, a plugin was switched off). */
  onStatusBarChanged?: () => void
  /** A session in chat mode changed (see `shared/domain/chat.ts`). */
  onChatChanged?: (state: ChatState) => void
  /** Test-only: starts chat processes instead of a login shell running `claude`. */
  chatSpawn?: SpawnChat
  /** Let the Claude usage plugin read the macOS Keychain: only against the real `~/.claude`,
   *  never a test fixture's, since a Keychain read can put a permission prompt on screen. */
  statusBarKeychain?: boolean
  /**
   * Called after an index pass that actually changed something. Indexing runs behind whatever the
   * user is doing, so a search typed while it was still running would otherwise sit on results
   * that were incomplete at the moment they were fetched, with nothing to prompt a re-query.
   */
  onIndexUpdated?: () => void
  /** Where sessions come from (MAIN-18). Defaults to `ClaudeProjectsSource`, built from
   *  `configRoot` — the only source that exists today. Injectable for tests and for a future
   *  second source. */
  source?: SessionSource
  /**
   * Injectable collaborators (TEST-6 / MAIN-14 step 1). Each defaults to today's construction, so
   * every existing caller is unaffected; a test can now pass a fake `pty` or `store` instead of
   * getting a real node-pty process or a real SQLite file. `plugins`, if supplied, is used as-is —
   * the constructor then skips its own registration of the built-in plugins (MAIN-17), since a
   * caller handing in a whole registry has already decided what is in it.
   */
  deps?: {
    pty?: PtyManager
    store?: SessionStore
    plugins?: PluginRegistry
    statusBar?: StatusBarRegistry
  }
}

export class AppService {
  readonly pty: PtyManager
  private store: SessionStore
  private disposed = false
  private readonly plugins: PluginRegistry
  /** The status-bar plugins (Claude usage first). Started by `startStatusBar`, not here. */
  readonly statusBar: StatusBarRegistry
  /** The trust boundary (MAIN-14 step 2) — see `sessions/sessionResolver.ts`. */
  private readonly resolver: SessionResolver
  /** Every `git*` operation (MAIN-14 step 3) — see `git/gitService.ts`. */
  private readonly git: GitService
  /** VS Code availability/open (MAIN-14 step 4) — see `vscode/vscodeService.ts`. */
  private readonly vscode: VsCodeService
  /** Pasted-image storage (MAIN-14 step 4) — see `media/imageStore.ts`. */
  private readonly images: ImageStore
  /** Content/note search, the index and its worker (MAIN-14 step 4) — see `search/searchService.ts`. */
  private readonly search: SearchService
  /** Resume/fork/new-session/shell/sendPrompt (MAIN-14 step 4) — see `terminals/terminalService.ts`. */
  private readonly terminals: TerminalService
  private readonly chats: ChatManager
  private readonly source: SessionSource
  /** Refresh loop, the live map, tree/discovered/import (MAIN-14 step 5) — see `sessions/sessionCatalog.ts`. */
  private readonly catalog: SessionCatalog
  /** rename/note/remove/move (MAIN-14 step 6) — see `sessions/sessionActions.ts`. */
  private readonly actions: SessionActions

  constructor(options: AppServiceOptions) {
    this.source = options.source ?? new ClaudeProjectsSource(options.configRoot)
    this.pty = options.deps?.pty ?? new PtyManager()
    this.store = options.deps?.store ?? new SessionStore(options.dbPath)
    this.resolver = new SessionResolver({ store: this.store, pty: this.pty })
    this.git = new GitService({ resolver: this.resolver, glabPath: options.glabPath })
    this.vscode = new VsCodeService({ resolver: this.resolver, vsCodePath: options.vsCodePath ?? null })
    this.images = new ImageStore({ dir: options.imagesDir ?? join(dirname(options.dbPath), 'pasted-images') })
    this.search = new SearchService({
      store: this.store,
      dbPath: options.searchDbPath ?? join(dirname(options.dbPath), 'search.db'),
      searchChatContent: options.searchChatContent,
      searchSessionNotes: options.searchSessionNotes,
      onIndexUpdated: options.onIndexUpdated,
      isDisposed: () => this.disposed,
    })
    this.terminals = new TerminalService({
      pty: this.pty,
      resolver: this.resolver,
      store: this.store,
      claudeBin: options.claudeBin,
      promptPath: options.promptPath,
      zshPromptShim: options.zshPromptShim,
    })
    this.chats = new ChatManager({
      claudeBin: () => this.terminals.getClaudeBin() ?? undefined,
      onChange: (state) => {
        if (state.previousSessionId !== null && !this.chatAdopted.has(state.sessionId)) this.chatAdoptions.add(state.sessionId)
        options.onChatChanged?.(state)
      },
      spawn: options.chatSpawn,
    })
    this.catalog = new SessionCatalog({
      store: this.store,
      source: this.source,
      detectLive: options.detectLive,
      autoImportAll: options.autoImportAll,
      isDisposed: () => this.disposed,
      updateSearchIndex: () => this.updateSearchIndex(),
    })
    this.actions = new SessionActions({
      store: this.store, source: this.source, resolver: this.resolver,
      catalog: this.catalog, search: this.search, pty: this.pty,
    })
    if (options.deps?.plugins) {
      // A caller handing in a whole registry has already decided what is registered in it —
      // registering the built-in plugins on top would silently add a plugin a test's fake
      // registry never asked for.
      this.plugins = options.deps.plugins
    } else {
      this.plugins = new PluginRegistry({ onChanged: () => options.onPluginsChanged?.() })
      // Registration itself has nothing plugin-specific left in it (MAIN-17): a new entry in
      // `BUILTIN_PLUGINS` is a new plugin, with no change here. `options.plugins` (what the user
      // has actually set) wins over the plugin's own `defaultEnabled` for someone who has never
      // touched this plugin's setting at all.
      for (const factory of BUILTIN_PLUGINS) {
        const plugin = factory({ glabPath: options.glabPath })
        this.plugins.register(plugin, options.plugins?.[plugin.id] ?? plugin.defaultEnabled ?? true)
      }
    }
    this.statusBar = options.deps?.statusBar ?? new StatusBarRegistry({ onChanged: () => options.onStatusBarChanged?.() })
    // Like the session-bar plugins above: a caller that injected its own registries decided what
    // is in them, so the built-ins are not added on top.
    const builtinStatusBar = options.deps?.statusBar === undefined && options.deps?.plugins === undefined
    for (const factory of builtinStatusBar ? BUILTIN_STATUS_BAR_PLUGINS : []) {
      const plugin = factory({ configRoot: options.configRoot, useKeychain: options.statusBarKeychain ?? false })
      this.statusBar.register(plugin, options.plugins?.[plugin.id] ?? plugin.defaultEnabled ?? true)
    }
    for (const [id, values] of Object.entries(options.pluginSettings ?? {})) {
      if (this.statusBar.has(id)) this.statusBar.setSettings(id, values)
      else this.plugins.setSettings(id, values)
    }
  }

  /** Starts the status-bar plugins' own schedules. Separate from construction so that building an
   *  AppService (every integration test does) never starts a network poll. */
  startStatusBar(): void {
    this.statusBar.start()
  }

  /**
   * What the session-bar plugins would put on this session's bar.
   *
   * Synchronous from the cache — the bar redraws on every git-status poll, and a plugin that talks
   * to the network cannot be on that path. A cold or stale answer refreshes in the background and
   * announces itself through `onPluginsChanged`.
   */
  pluginBarItems(terminal: TerminalRef): PluginBarItem[] {
    const ctx = this.pluginContext(terminal)
    return ctx === null ? [] : this.plugins.items(ctx)
  }

  /** Forces a lookup, for the bar's own refresh action. */
  async refreshPluginBar(terminal: TerminalRef): Promise<PluginBarItem[]> {
    const ctx = this.pluginContext(terminal)
    return ctx === null ? [] : this.plugins.refresh(ctx)
  }

  /**
   * The folder and branch a plugin is asked about.
   *
   * Returns null rather than throwing for a session whose folder has gone: the bar is drawn for
   * such a session too (it is how you find out the folder has gone), and it simply has no plugin
   * buttons on it.
   */
  private pluginContext(terminal: TerminalRef): { cwd: string; branch: string | null } | null {
    let cwd: string
    try {
      cwd = this.resolver.resolveShellCwd(terminal)
    } catch {
      return null
    }
    return { cwd, branch: this.git.lastBranchFor(cwd) }
  }

  setPluginEnabled(pluginId: string, enabled: boolean): void {
    if (this.statusBar.has(pluginId)) this.statusBar.setEnabled(pluginId, enabled)
    else this.plugins.setEnabled(pluginId, enabled)
  }

  setPluginSettings(pluginId: string, values: Record<string, string | number | boolean>): void {
    if (this.statusBar.has(pluginId)) this.statusBar.setSettings(pluginId, values)
    else this.plugins.setSettings(pluginId, values)
  }

  /** Session-bar and status-bar plugins together: Settings has one Plugins section for both. */
  listPlugins(): ReturnType<PluginRegistry['list']> {
    return [...this.plugins.list(), ...this.statusBar.list()]
  }

  /**
   * Changes how shells started from now on show their path. Shells already running keep the
   * environment they were spawned with — a variable cannot be pushed into a live process — so the
   * setting's help text says the change applies to new terminals.
   */
  setPromptPath(options: PromptPathOptions): void {
    this.terminals.setPromptPath(options)
  }

  /** Rescans and refreshes live-session state; see `sessions/sessionCatalog.ts` for the state machine. */
  async refresh(opts?: { full?: boolean; paths?: string[] }): Promise<void> {
    await this.catalog.refresh(opts)
    this.adoptChatSessions()
  }

  /**
   * Sessions a chat moved onto with `/clear`, waiting for their file to be scanned. They belong in
   * the library as much as the session they continue — the window's tab follows the chat onto
   * them — but a folder without auto-import would otherwise leave them undiscovered-only.
   */
  private readonly chatAdoptions = new Set<string>()
  /** Adopted already: every later state of that chat still names the session it left, and an
   *  adoption must not undo the user archiving the session afterwards. */
  private readonly chatAdopted = new Set<string>()

  private adoptChatSessions(): void {
    for (const id of [...this.chatAdoptions]) {
      if (this.store.getSession(id) === null) continue
      this.store.setImported([id], true)
      this.chatAdoptions.delete(id)
      this.chatAdopted.add(id)
    }
  }

  /** One folder's project row re-resolved through git (MAIN-4); see SessionCatalog. */
  async refreshProject(cwd: string): Promise<void> {
    return this.catalog.refreshProject(cwd)
  }

  /** Same as `refreshProject`, but for one of the cwd-carrying `TerminalRef` IPC calls. */
  async refreshProjectByKey(terminal: TerminalRef): Promise<void> {
    await this.refreshProject(this.resolver.resolveShellCwd(terminal))
  }

  async tree(): Promise<ProjectNode[]> {
    return this.catalog.tree()
  }

  // Every search* method below is a one-line delegate to SearchService (MAIN-14 step 4) — kept
  // here so ipc/handlers and appService.test.ts do not have to change what they call.

  /**
   * Session ids matched by anything other than their title: the conversation, the user's note, or
   * both, according to which of the two are switched on. They are independent — a note is a line
   * the user wrote and costs nothing to keep indexed, so it stays searchable even for someone who
   * has turned transcript indexing off.
   */
  async searchSessions(query: string): Promise<string[]> {
    return this.search.search(query)
  }

  setSearchChatContent(enabled: boolean): void {
    this.search.setChatContentEnabled(enabled)
  }

  setSearchSessionNotes(enabled: boolean): void {
    this.search.setSessionNotesEnabled(enabled)
  }

  async setSessionNote(sessionId: string, note: string): Promise<void> {
    return this.actions.setSessionNote(sessionId, note)
  }

  sessionNote(sessionId: string): string {
    return this.actions.sessionNote(sessionId)
  }

  async rebuildSearchIndex(): Promise<void> {
    return this.search.rebuild()
  }

  searchIndexCount(): number {
    return this.search.indexCount()
  }

  searchNoteCount(): number {
    return this.search.noteCount()
  }

  async updateSearchIndex(): Promise<void> {
    return this.search.update()
  }

  async discovered(): Promise<StoredSession[]> {
    return this.catalog.discovered()
  }

  async importAllDiscovered(): Promise<number> {
    return this.catalog.importAllDiscovered()
  }

  async importSessions(sessionIds: string[], autoImportProjects: string[]): Promise<void> {
    return this.catalog.importSessions(sessionIds, autoImportProjects)
  }

  async transcript(sessionId: string, beforeIndex?: number): Promise<TranscriptPage> {
    const session = this.resolver.requireSession(sessionId)
    // Claude's own session files can be deleted out from under Apiary — most often by removing
    // the git worktree the session ran in, which takes its whole `~/.claude/projects/<slug>`
    // directory with it. Saying so in one sentence is far more use than the raw
    // `ENOENT: no such file or directory, stat '/…'` this would otherwise reject with.
    if (!existsSync(session.filePath)) {
      throw new Error(
        `This session's transcript file is no longer on disk: ${session.filePath}. ` +
        'It was most likely deleted along with the folder it ran in. ' +
        'Remove the session from the sidebar to stop it being listed.',
      )
    }
    const page = await readTranscriptPage(session.filePath, { beforeIndex })
    if (session.messageCount === null) {
      const { messageCount } = await indexTranscript(session.filePath)
      this.store.setMessageCount(sessionId, messageCount)
    }
    return page
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    return this.actions.renameSession(sessionId, title)
  }

  async removeSession(sessionId: string): Promise<void> {
    return this.actions.removeSession(sessionId)
  }

  async moveSession(sessionId: string, targetProjectPath: string): Promise<void> {
    return this.actions.moveSession(sessionId, targetProjectPath)
  }

  async checkConflict(sessionId: SessionId): Promise<ResumeConflict | null> {
    // A chat this app is running is not "someone else's" process: opening the session in a
    // terminal stops it (see `resume`), so it must not raise the conflict dialog.
    if (this.chats.has(sessionId)) return null
    return this.catalog.checkConflict(sessionId)
  }

  // resume, openShell*, newSessionIn*, forkSession and sendPrompt below are one-line delegates to
  // TerminalService (MAIN-14 step 4) — kept here so ipc/handlers and appService.test.ts do not
  // have to change what they call.

  async resume(sessionId: string): Promise<void> {
    // One process per session: two `claude`s on one session would both append to its JSONL.
    if (this.chats.has(sessionId)) await this.chats.stop(sessionId)
    return this.terminals.resume(sessionId)
  }

  // Chat mode (`main/chat/`): the session driven over stream-json, as the VS Code extension does.

  chatState(sessionId: SessionId): ChatState | null {
    return this.chats.state(sessionId)
  }

  /**
   * Starts `sessionId` in chat mode, or returns the chat already running. A session running in a
   * terminal is refused unless `takeOver` — then that terminal's `claude` is stopped first, and
   * the chat resumes the same conversation.
   */
  async chatStart(
    sessionId: SessionId,
    opts: { takeOver: boolean; model?: ChatModel; permissionMode?: ChatPermissionMode; effort?: ChatEffort },
  ): Promise<ChatState> {
    const existing = this.chats.state(sessionId)
    if (existing !== null && existing.status !== 'exited') return existing
    if (this.pty.has(sessionId)) {
      if (!opts.takeOver) throw new Error('This session is running in its terminal')
      await this.pty.killAndWait(sessionId)
    }
    const session = this.resolver.requireSession(sessionId)
    const cwd = session.cwd
    if (!cwd || !existsSync(cwd)) {
      throw new Error(`The folder for this session no longer exists: ${cwd ?? 'unknown'}`)
    }
    return this.chats.start(sessionId, cwd, { model: opts.model, permissionMode: opts.permissionMode, effort: opts.effort })
  }

  chatSend(sessionId: SessionId, text: string): void { this.chats.send(sessionId, text) }
  chatInterrupt(sessionId: SessionId): void { this.chats.interrupt(sessionId) }
  chatRespond(sessionId: SessionId, requestId: string, decision: ChatDecision): void {
    this.chats.respond(sessionId, requestId, decision)
  }
  chatSetPermissionMode(sessionId: SessionId, mode: ChatPermissionMode): void { this.chats.setPermissionMode(sessionId, mode) }
  chatSetModel(sessionId: SessionId, model: ChatModel): void { this.chats.setModel(sessionId, model) }
  chatSetEffort(sessionId: SessionId, effort: ChatEffort): void { this.chats.setEffort(sessionId, effort) }
  async chatStop(sessionId: SessionId): Promise<void> { await this.chats.stop(sessionId) }

  /**
   * Whether stopping the session's terminal would cost anything: Claude mid-turn (read from the
   * rendered screen, as the activity dots are), or background tasks it started that have not
   * reported back (read from the session file) — they are its children and die with it. The
   * chat takes over only a terminal with neither.
   */
  async terminalBusy(sessionId: SessionId): Promise<TerminalBusy> {
    if (!this.pty.has(sessionId)) return { busy: false, backgroundTasks: 0 }
    const status = classifyActivity(this.pty.screen(sessionId), this.pty.lastOutputAt(sessionId), Date.now(), true)
    const session = this.resolver.requireSession(sessionId)
    const page = await readTranscriptPage(session.filePath).catch(() => null)
    return { busy: status !== 'idle', backgroundTasks: page === null ? 0 : runningBackgroundTasks(page.messages).length }
  }

  /**
   * What each of these sessions is doing, for the pets: the latest tool and its label, from the
   * end of its transcript (`latestAction` — never commands, output or conversation). Keys that
   * are not a known session (a new session's pty) are skipped; the paths are Apiary's own.
   */
  async latestActions(keys: string[]): Promise<{ key: string; action: string }[]> {
    const out: { key: string; action: string }[] = []
    for (const key of keys.slice(0, 8)) {
      try {
        const session = this.resolver.requireSession(key)
        const page = await readTranscriptPage(session.filePath, { limit: 12 })
        const action = latestAction(page.messages)
        if (action !== null) out.push({ key, action })
      } catch { /* not a session, or not readable: nothing to say about it */ }
    }
    return out
  }

  /** Whether VS Code was found on this machine at launch. Checked once; does not change at runtime. */
  vsCodeAvailable(): boolean {
    return this.vscode.available()
  }

  /** Opens the session's folder in VS Code. Rejects if VS Code was not found or the folder is gone. */
  async openInVsCode(terminal: TerminalRef): Promise<void> {
    await this.vscode.open(terminal)
  }

  async openShell(sessionId: SessionId, tabId: string): Promise<void> {
    return this.terminals.openShell(sessionId, tabId)
  }

  async openShellForPty(ptyId: PtyId, tabId: string): Promise<void> {
    return this.terminals.openShellForPty(ptyId, tabId)
  }

  // Every git* method below is a one-line delegate to GitService (MAIN-14 step 3) — kept here so
  // ipc/handlers and appService.test.ts do not have to change what they call.

  async gitStatus(terminal: TerminalRef): Promise<GitStatus | null> {
    return this.git.status(terminal)
  }

  async gitListRefs(terminal: TerminalRef): Promise<GitRefs> {
    return this.git.listRefs(terminal)
  }

  async gitlabMrRefStatus(
    terminal: TerminalRef, iids: number[],
  ): Promise<Record<number, MrState | null>> {
    return this.git.mrRefStatus(terminal, iids)
  }

  async gitCheckoutBranch(terminal: TerminalRef, name: string): Promise<CheckoutOutcome> {
    return this.git.checkoutBranch(terminal, name)
  }

  /** Pulls `branch` in the worktree that has it, which is the only place it *can* be pulled. */
  async gitPullWorktree(
    terminal: TerminalRef, branch: string,
  ): Promise<{ path: string; commits: number }> {
    return this.git.pullWorktree(terminal, branch)
  }

  /** Starts a new Claude session in the worktree that has `branch`. */
  async newSessionInWorktree(
    terminal: TerminalRef, branch: string,
  ): Promise<NewSessionInfo> {
    return this.newSessionInFolder(await this.git.requireWorktreeFor(terminal, branch))
  }

  async gitCheckoutRemote(terminal: TerminalRef, remoteRef: string, localName: string): Promise<void> {
    await this.git.checkoutRemote(terminal, remoteRef, localName)
  }

  async gitCheckoutDetached(terminal: TerminalRef, ref: string): Promise<void> {
    await this.git.checkoutDetached(terminal, ref)
  }

  async gitCreateBranch(terminal: TerminalRef, name: string, from?: string): Promise<void> {
    await this.git.createBranch(terminal, name, from)
  }

  async gitPull(terminal: TerminalRef): Promise<{ commits: number }> {
    return this.git.pull(terminal)
  }

  /** Fast-forwards any local branch from its upstream (the branch list's pull button). */
  async gitUpdateBranch(terminal: TerminalRef, branch: string): Promise<{ commits: number }> {
    return this.git.updateBranch(terminal, branch)
  }

  async gitPullFolder(path: string): Promise<{ commits: number }> {
    return this.git.pullFolder(path)
  }

  async worktreeCreateOptions(path: string): Promise<WorktreeCreateOptions> {
    return this.git.worktreeCreateOptions(path)
  }

  /** New worktree, then a Claude session in it — Apiary's "open" for a fresh worktree. The path
   *  comes back from git, never from the renderer, which is what makes `newSessionInFolder` safe. */
  async createWorktree(path: string, request: WorktreeCreateRequest): Promise<NewSessionInfo> {
    return this.terminals.newSessionInFolder(await this.git.createWorktree(path, request))
  }

  async listWorktrees(path: string): Promise<FolderWorktree[]> {
    return this.git.listWorktrees(path)
  }

  async gitPush(terminal: TerminalRef): Promise<{ commits: number; published: boolean }> {
    return this.git.push(terminal)
  }

  async gitMerge(terminal: TerminalRef, ref: string): Promise<void> {
    await this.git.merge(terminal, ref)
  }

  async gitFetch(terminal: TerminalRef): Promise<void> {
    await this.git.fetch(terminal)
  }

  async newSessionInProject(path: string): Promise<NewSessionInfo> {
    return this.terminals.newSessionInProject(path)
  }

  /**
   * Starts a brand-new session in an arbitrary folder. Only safe to call with a path the main
   * process obtained itself (the native folder-picker dialog) — never with a string handed in
   * by the renderer.
   */
  async newSessionInFolder(path: string): Promise<NewSessionInfo> {
    return this.terminals.newSessionInFolder(path)
  }

  forkSession(sessionId: string): NewSessionInfo {
    return this.terminals.forkSession(sessionId)
  }

  sessionIsResumable(sessionId: string): boolean {
    return this.catalog.sessionIsResumable(sessionId)
  }

  async dispose(): Promise<void> {
    // Set synchronously, before any await: any refresh loop currently checking
    // `this.pendingRefresh && !this.disposed` in the same tick will see this and stop
    // scheduling further passes, so no fire-and-forget rerun can start after this point.
    this.disposed = true
    this.statusBar.stop()
    await this.chats.stopAll()
    await this.pty.killAll()
    // Let any refresh already in flight (or its already-chained rerun) finish before closing
    // the database — otherwise it could try to write through a closed better-sqlite3 handle.
    await this.catalog.whenIdle()
    this.store.close()
    // Closes the index and the content-search worker thread's own SQLite handle (MAIN-20) — see
    // `SearchService.close`.
    await this.search.close()
    // Releases any plugin holding something of its own (MAIN-17/MAIN-20). No current plugin needs
    // this; it exists so a future one that does has somewhere to put its teardown.
    this.plugins.dispose()
  }

  /** The configured `claude`, or null for "find it on PATH" — the theme generator runs the same one. */
  get claudeBin(): string | null {
    return this.terminals.getClaudeBin()
  }

  setClaudeBin(path: string | null): void {
    this.terminals.setClaudeBin(path)
  }

  setAutoImportAll(enabled: boolean): void {
    this.catalog.setAutoImportAll(enabled)
  }

  /**
   * Writes an image pasted into the composer to disk and returns its absolute path. See
   * `media/imageStore.ts` for why it lives on disk, in Apiary's own data directory.
   */
  async saveImage(base64: string, mediaType: string): Promise<string> {
    return this.images.save(base64, mediaType)
  }

  /**
   * Reads one previously-saved image back as a data URL, for the thumbnails and the lightbox. See
   * `media/imageStore.ts` for the confinement check.
   */
  async readImage(path: string): Promise<{ dataUrl: string } | null> {
    return this.images.read(path)
  }

  /** Delivers a composed prompt to a session's running `claude` process. See
   *  `terminals/terminalService.ts` for the bracketed-paste and settle-timing rationale. */
  async sendPrompt(ptyId: string, text: string): Promise<void> {
    return this.terminals.sendPrompt(ptyId, text)
  }
}
