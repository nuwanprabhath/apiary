import { existsSync } from 'node:fs'
import { mkdir, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { extractMeta } from './scanner/sessionScanner'
import { ClaudeProjectsSource, type SessionSource } from './sources/claudeProjects'
import { resolveProject, clearResolverCache, resetResolverSpawnCount, resolverSpawnCount } from './git/worktreeResolver'
import { SessionStore } from './store/sessionStore'
import { buildTree } from './tree/buildTree'
import { indexTranscript, readTranscriptPage } from './transcript/transcriptReader'
import { detectLiveSessions } from './claude/live/liveSessionDetector'
import { PtyManager } from './pty/ptyManager'
import { SessionResolver } from './sessions/sessionResolver'
import { GitService } from './git/gitService'
import { SearchService } from './search/searchService'
import type { PromptPathOptions } from './pty/promptPath'
import { TerminalService } from './terminals/terminalService'
import { log } from './log/logger'
import { memoize } from './util/memoize'
import { PluginRegistry } from './plugins/registry'
import { BUILTIN_PLUGINS } from './plugins/builtin'
import type { PluginBarItem } from './plugins/types'
import type { MrState } from './git/mrStatusCache'
import { VsCodeService } from './vscode/vscodeService'
import { ImageStore } from './media/imageStore'
import type {
  ProjectNode, ResumeConflict, TranscriptPage, NewSessionInfo, CheckoutOutcome,
} from '@shared/types'
import type { StoredSession } from './store/sessionStore'
import type { SessionMeta, ProjectInfo, GitStatus, GitRefs, FolderWorktree } from '@shared/types'

/** What a refresh pass was asked to cover — see `refresh()`. */
interface RefreshRequest {
  /** A full rescan: every transcript is stat'd (unchanged ones are still skipped — see
   *  `isUnchanged` below), and every distinct cwd the store knows about is re-resolved through
   *  git, not just the ones with a changed file. This is what the Refresh button, the app menu
   *  and the `refresh` IPC channel ask for, and what every caller gets by omitting `opts`
   *  entirely — the behaviour this class had before MAIN-1. */
  full: boolean
  /** A scoped pass (MAIN-1): only these transcript paths are re-read, and only their cwds are
   *  re-resolved. Ignored when `full` is true. */
  paths: Set<string>
}

/** How many folders are resolved concurrently in one refresh pass (MAIN-1 step 7). Resolution is
 *  a few sequential git spawns per folder; a small cap keeps a large library from serializing
 *  entirely on process-spawn latency without opening hundreds of git processes at once. */
const RESOLVE_CONCURRENCY = 8

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
  }
}

export class AppService {
  readonly pty: PtyManager
  private store: SessionStore
  private options: AppServiceOptions
  private live = new Map<string, number>()
  private refreshPromise: Promise<void> | null = null
  /** Set while a pass is in flight, so the trigger that arrived mid-pass is not silently lost —
   *  see `refresh()`. `full` always wins when merging two pending requests. */
  private pendingRefresh: RefreshRequest | null = null
  private disposed = false
  private autoImportAll = false
  private readonly plugins: PluginRegistry
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
  private readonly source: SessionSource

  constructor(options: AppServiceOptions) {
    this.options = options
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
    this.autoImportAll = options.autoImportAll ?? false
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
    for (const [id, values] of Object.entries(options.pluginSettings ?? {})) {
      this.plugins.setSettings(id, values)
    }
  }

  /**
   * What the session-bar plugins would put on this session's bar.
   *
   * Synchronous from the cache — the bar redraws on every git-status poll, and a plugin that talks
   * to the network cannot be on that path. A cold or stale answer refreshes in the background and
   * announces itself through `onPluginsChanged`.
   */
  pluginBarItems(key: string, isPtyId: boolean): PluginBarItem[] {
    const ctx = this.pluginContext(key, isPtyId)
    return ctx === null ? [] : this.plugins.items(ctx)
  }

  /** Forces a lookup, for the bar's own refresh action. */
  async refreshPluginBar(key: string, isPtyId: boolean): Promise<PluginBarItem[]> {
    const ctx = this.pluginContext(key, isPtyId)
    return ctx === null ? [] : this.plugins.refresh(ctx)
  }

  /**
   * The folder and branch a plugin is asked about.
   *
   * Returns null rather than throwing for a session whose folder has gone: the bar is drawn for
   * such a session too (it is how you find out the folder has gone), and it simply has no plugin
   * buttons on it.
   */
  private pluginContext(key: string, isPtyId: boolean): { cwd: string; branch: string | null } | null {
    let cwd: string
    try {
      cwd = this.resolver.resolveShellCwd(key, isPtyId)
    } catch {
      return null
    }
    return { cwd, branch: this.git.lastBranchFor(cwd) }
  }

  setPluginEnabled(pluginId: string, enabled: boolean): void {
    this.plugins.setEnabled(pluginId, enabled)
  }

  setPluginSettings(pluginId: string, values: Record<string, string | number | boolean>): void {
    this.plugins.setSettings(pluginId, values)
  }

  listPlugins(): ReturnType<PluginRegistry['list']> {
    return this.plugins.list()
  }

  /**
   * Changes how shells started from now on show their path. Shells already running keep the
   * environment they were spawned with — a variable cannot be pushed into a live process — so the
   * setting's help text says the change applies to new terminals.
   */
  setPromptPath(options: PromptPathOptions): void {
    this.terminals.setPromptPath(options)
  }

  /**
   * Rescans the config root and refreshes live-session state.
   *
   * Reentrancy guard: the filesystem watcher, the IPC handler, and app
   * startup can all call this concurrently — most acutely the watcher, whose
   * 1s debounce only guards a *pending* timer, not an in-flight `refresh()`,
   * so on a machine with many projects (each `resolveProject` shelling out
   * to `git`) a single refresh can easily outlast the debounce window while
   * Claude keeps appending to session files. If a run is already in flight,
   * this joins that run's promise rather than starting a second one
   * immediately (so two runs never race on `clearResolverCache()`/git work
   * at once) — but it also sets `pendingRefresh`, so the change that
   * triggered this call is not silently lost. Once the in-flight run
   * finishes, `finally` checks that flag and, if set, runs exactly one more
   * pass before resolving; because the second pass is chained onto the same
   * returned promise, every caller — including the one that only joined —
   * still ends up awaiting a refresh that actually observed its own
   * trigger. This is a single pending-rerun flag, not a queue: calls that
   * arrive while the rerun itself is in flight just re-set the same flag,
   * so this can never accumulate a backlog, only ever run one extra pass
   * per already-running pass. `disposed` (set by `dispose()`) stops a new
   * pass from ever being scheduled once shutdown has started, so a
   * fire-and-forget rerun can never land after the store is closed.
   */
  /**
   * `opts` omitted (every pre-MAIN-1 caller: the Refresh button, the menu, the `refresh` IPC
   * channel, `moveSession`) means a full rescan, exactly as before. `{ paths }` is a scoped pass
   * — what the filesystem watcher now asks for: only those transcripts are re-read, and only
   * their cwds are re-resolved through git, instead of every session in the library and every
   * folder it has ever seen (MAIN-1).
   */
  private normalizeRefreshRequest(opts?: { full?: boolean; paths?: string[] }): RefreshRequest {
    if (!opts || opts.full === true || !opts.paths || opts.paths.length === 0) {
      return { full: true, paths: new Set() }
    }
    return { full: false, paths: new Set(opts.paths) }
  }

  async refresh(opts?: { full?: boolean; paths?: string[] }): Promise<void> {
    const req = this.normalizeRefreshRequest(opts)
    if (this.refreshPromise) {
      if (!this.pendingRefresh) {
        this.pendingRefresh = req
      } else if (this.pendingRefresh.full || req.full) {
        this.pendingRefresh = { full: true, paths: new Set() }
      } else {
        for (const p of req.paths) this.pendingRefresh.paths.add(p)
      }
      return this.refreshPromise
    }
    this.refreshPromise = this.runRefreshLoop(req)
    return this.refreshPromise
  }

  private async runRefreshLoop(req: RefreshRequest): Promise<void> {
    try {
      await this.runRefresh(req)
    } catch (e) {
      // A rejection must not wedge future refreshes: clear both the in-flight pointer and
      // any pending-rerun request, then propagate the failure to everyone awaiting this run
      // (the original caller and anyone who joined it) exactly as before this fix.
      this.pendingRefresh = null
      this.refreshPromise = null
      throw e
    }
    if (this.pendingRefresh && !this.disposed) {
      const next = this.pendingRefresh
      this.pendingRefresh = null
      // Chain the rerun onto this same promise so every caller of this run — including one
      // that only joined an in-flight refresh — actually observes a pass that ran after their
      // trigger, not the stale snapshot the joined pass started with.
      this.refreshPromise = this.runRefreshLoop(next)
      return this.refreshPromise
    }
    this.refreshPromise = null
  }

  private async runRefresh(req: RefreshRequest): Promise<void> {
    const started = Date.now()
    // A full pass re-resolves every folder from scratch (a checkout done outside Apiary, a
    // worktree removed); a scoped pass keeps the resolver's structural answers from earlier
    // passes and only re-resolves the folders whose files actually changed.
    if (req.full) clearResolverCache()
    resetResolverSpawnCount()

    let metas: SessionMeta[]
    let filesSeen: number
    let filesParsed = 0
    if (req.full) {
      // The store already knows every session's file size and mtime; skip re-reading (and
      // re-parsing up to 128KB of) a file whose stat matches what is already on record. This is
      // the same technique the search indexer already uses (indexer.ts).
      const stamps = this.store.fileStamps()
      const stats = { filesSeen: 0, filesParsed: 0 }
      metas = await this.source.scan({
        isUnchanged: (path, size, mtimeMs) => {
          const stamp = stamps.get(path)
          return stamp !== undefined && stamp.size === size && stamp.mtimeMs === mtimeMs
        },
        stats,
      })
      filesSeen = stats.filesSeen
      filesParsed = stats.filesParsed
    } else {
      // Scoped: the watcher already told us exactly which files changed, so there is no directory
      // to walk — each path is re-read directly, unconditionally (the watcher's own
      // `awaitWriteFinish` is what decided this file is worth looking at again).
      metas = []
      filesSeen = req.paths.size
      for (const path of req.paths) {
        if (this.disposed) return
        if (!path.endsWith('.jsonl')) continue
        try {
          metas.push(await extractMeta(path))
          filesParsed += 1
        } catch {
          // Deleted between the watcher event and this read, or unreadable — a scoped pass simply
          // leaves that session's row as it was; a later full pass reconciles it.
        }
      }
    }
    // A pass can take a long time — resolving each folder is a few git calls, and a library of a
    // few hundred folders measured ~35s — and quitting waits for the pass in flight (see
    // `dispose()`). So it checks at every step whether shutdown has started, and stops: everything
    // it would have written is derived from the JSONL and is rebuilt by the next launch's scan.
    // Without this a quit during a big rescan left the process running, windowless, for as long
    // as the rescan had left.
    if (this.disposed) return

    const byRawCwd = new Map<string, SessionMeta[]>()
    for (const m of metas) {
      if (!m.cwd) continue // Without a cwd there is nothing to group or resume against.
      const list = byRawCwd.get(m.cwd) ?? []
      list.push(m)
      byRawCwd.set(m.cwd, list)
    }

    // On a full pass every distinct cwd the store already knows about is re-resolved, not just
    // the ones with a changed file this pass — a folder's branch or worktree status can change
    // with nobody ever touching a transcript in it. A scoped pass only re-resolves the cwds of
    // the files that actually changed.
    const cwdsToResolve = new Set(byRawCwd.keys())
    if (req.full) {
      for (const cwd of this.store.distinctCwds()) cwdsToResolve.add(cwd)
    }

    // Resolve every distinct raw cwd to its canonical project path first, then
    // group by that canonical key. Two JSONL files that record the same
    // directory via different routes (e.g. one through a symlink) must land
    // under one project row, not split across two: resolveProject already
    // canonicalizes with realpath, so syncProject and syncSessions must be
    // keyed on ProjectInfo.path rather than the raw string read from the JSONL.
    const byCanonicalCwd = new Map<string, SessionMeta[]>()
    const infoByCanonicalCwd = new Map<string, ProjectInfo>()
    const rawCwds = [...cwdsToResolve]
    let cursor = 0
    const resolveWorker = async (): Promise<void> => {
      for (;;) {
        if (this.disposed) return
        const i = cursor
        cursor += 1
        if (i >= rawCwds.length) return
        const rawCwd = rawCwds[i]
        const info = await resolveProject(rawCwd)
        infoByCanonicalCwd.set(info.path, info)
        const list = byRawCwd.get(rawCwd)
        const existing = byCanonicalCwd.get(info.path) ?? []
        if (list) existing.push(...list)
        byCanonicalCwd.set(info.path, existing)
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(RESOLVE_CONCURRENCY, rawCwds.length) }, resolveWorker),
    )

    if (this.disposed) return
    const entries: { info: ProjectInfo; metas: SessionMeta[] }[] = []
    for (const [canonicalCwd, list] of byCanonicalCwd) {
      const info = infoByCanonicalCwd.get(canonicalCwd)
      if (!info) continue
      entries.push({ info, metas: list })
    }
    // One commit for the whole pass instead of two fsyncing transactions per project (MAIN-2).
    this.store.syncAll(entries)

    // "Measure before fixing" (CLAUDE.md): what MAIN-1 set out to cut down, on every pass.
    log.info('refresh', 'pass', {
      full: req.full,
      files: filesSeen,
      parsed: filesParsed,
      folders: rawCwds.length,
      gitSpawns: resolverSpawnCount(),
      ms: Date.now() - started,
    })

    if (this.disposed) return
    this.live = await (this.options.detectLive ?? detectLiveSessions)()
    if (this.disposed) return
    // Inside the refresh itself, rather than at each of its callers: the Refresh button, the file
    // watcher and the periodic rescan all arrive here, and a setting called "import everything
    // automatically" that only held for some of those routes would be the worst kind of half-true.
    if (this.autoImportAll) {
      await this.importAllDiscovered()
    }
    // Deliberately not awaited: see updateSearchIndex.
    void this.updateSearchIndex()
  }

  /**
   * Re-resolves and syncs one folder's project row through git — without touching a single
   * transcript or resolving any other folder (MAIN-4). Used after a git mutation that can change
   * what the sidebar shows for this one folder (a checkout, a new branch), so the answer comes
   * back in git time instead of waiting for (and paying for) a full-library rescan.
   *
   * Bypasses the resolver's cache deliberately: the mutation this follows is the reason the
   * cached answer is now stale.
   */
  async refreshProject(cwd: string): Promise<void> {
    const info = await resolveProject(cwd, { forceResolve: true })
    this.store.syncProject(info)
  }

  /** Same as `refreshProject`, but for one of the cwd-carrying (`key`, `isPtyId`) IPC calls. */
  async refreshProjectByKey(key: string, isPtyId: boolean): Promise<void> {
    await this.refreshProject(this.resolver.resolveShellCwd(key, isPtyId))
  }

  /**
   * `buildTree` calls `cwdExists` once per *session*, not once per distinct cwd (MAIN-10) — every
   * window calls `tree()` on every `treeChanged` (after every watcher pass, every index update),
   * so a library with many sessions per folder turned into that many synchronous `existsSync`
   * calls per broadcast. Memoised per call here rather than in `buildTree` itself, which stays a
   * pure function of whatever `cwdExists` it is handed.
   */
  async tree(): Promise<ProjectNode[]> {
    return buildTree(
      this.store.visibleProjects(),
      this.store.visibleSessions(),
      new Set(this.live.keys()),
      memoize(existsSync),
    )
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

  /**
   * Saves the user's note for a session, and keeps the index in step with it.
   *
   * The index write happens here rather than being left to the next background pass: a note is
   * written so it can be found again, and a note that is not searchable until some later rescan
   * is a note that appears not to work.
   */
  async setSessionNote(sessionId: string, note: string): Promise<void> {
    this.resolver.requireSession(sessionId)
    const trimmed = note.trim()
    this.store.setNote(sessionId, trimmed === '' ? null : trimmed)
    this.search.putNoteIfEnabled(sessionId, trimmed === '' ? null : trimmed)
  }

  /**
   * The note for one session, for the editor to open with what is already there.
   *
   * `getSession` is an indexed lookup by primary key; `allSessions().find(...)` (MAIN-10) mapped
   * and scanned every row in the store to find one.
   */
  sessionNote(sessionId: string): string {
    return this.store.getSession(sessionId)?.note ?? ''
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
    return this.store.allSessions()
  }

  /**
   * Marks every discovered, not-yet-imported session as imported; returns how many that was.
   *
   * Deliberately does not touch the per-project auto-import flag `importSessions` sets. That flag
   * is a standing instruction about one folder, chosen in the import dialog; this is a global
   * switch that can be turned off again, and writing per-folder flags from here would leave those
   * folders importing forever afterwards with nothing in the UI explaining why.
   */
  async importAllDiscovered(): Promise<number> {
    const sessions = this.store.allSessions()
    const toImport = sessions.filter((s) => !s.imported).map((s) => s.sessionId)
    if (toImport.length > 0) {
      this.store.setImported(toImport, true)
    }
    return toImport.length
  }

  /**
   * Marks sessions imported. Paths in `autoImportProjects` also get the
   * auto-import flag so future sessions there appear without a re-import.
   * Callers may pass a raw (possibly symlinked) cwd, so each path is
   * canonicalized the same way `refresh()` keys project rows — otherwise the
   * flag would be written under a path no project row actually has.
   *
   * Each path must already name a project this store knows about (SEC-8): the renderer's own
   * caller only ever offers back a `projectPath` this process handed it through `discovered()`,
   * but the IPC boundary does not know that — and `resolveProject` runs `git` with `cwd` set to
   * whatever it is given, which is exactly the "renderer supplies a filesystem path" pattern
   * CLAUDE.md says main never accepts. `getProject` is the same check `newSessionInProject` uses
   * for the identical reason.
   */
  async importSessions(sessionIds: string[], autoImportProjects: string[]): Promise<void> {
    for (const path of autoImportProjects) {
      if (this.store.getProject(path) === null) {
        throw new Error(`Unknown project: ${path}`)
      }
    }
    this.store.setImported(sessionIds, true)
    for (const path of autoImportProjects) {
      const info = await resolveProject(path)
      this.store.setAutoImport(info.path, true)
    }
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

  /**
   * Sets (or, given an empty/whitespace-only string, clears) a session's user-facing title.
   * Validated the same way every other id-carrying call is: the session must already be one this
   * store knows about, never trusted purely because the renderer sent an id that looks right.
   */
  async renameSession(sessionId: string, title: string): Promise<void> {
    this.resolver.requireSession(sessionId)
    const trimmed = title.trim()
    this.store.setCustomTitle(sessionId, trimmed === '' ? null : trimmed)
  }

  /**
   * Removes a session from Apiary's own view without touching the JSONL file it was read from
   * (`~/.claude/projects` stays strictly read-only — see the comment on `SessionStore.setArchived`).
   * Refuses while a live process is still attached to it: silently hiding a session that is still
   * being written to would make it unreachable from the UI while the process outlives it.
   */
  async removeSession(sessionId: string): Promise<void> {
    this.resolver.requireSession(sessionId)
    if (this.live.has(sessionId)) {
      throw new Error('This session is still running — close it before removing it.')
    }
    this.store.setArchived(sessionId, true)
  }

  /**
   * Moves a session's transcript into another worktree's Claude projects directory and points the
   * store at it from then on. Refused outright while the session is live: a running pty cannot be
   * asked to change the directory a whole process tree is rooted in.
   */
  async moveSession(sessionId: string, targetProjectPath: string): Promise<void> {
    const session = this.resolver.requireSession(sessionId)
    // Both sources of liveness, because neither one alone is current. `this.live` is the external
    // process scan, refreshed only by `refresh()` — so a session the user resumed *here* a moment
    // ago is not in it until the next rescan. `this.pty.has()` is this process's own ptys, which
    // is what `resume()` and `openShell()` already trust, and it knows immediately. With only the
    // stale half, clicking Resume and then dragging that session onto another worktree passed the
    // guard and renamed the JSONL out from under a running Claude Code, which simply recreated the
    // file at the old path — the history then split in two, with the store pointing at the copy
    // that stopped being written to.
    if (this.pty.has(sessionId) || this.live.has(sessionId)) {
      throw new Error('This session is still running — stop it before moving it to another worktree.')
    }
    if (!existsSync(session.filePath)) {
      throw new Error(`This session's transcript file is no longer on disk: ${session.filePath}`)
    }
    // The renderer only ever hands back a path it was shown in the tree (a project row's own
    // path), but it is still checked against a row this store already holds before it is used to
    // touch the filesystem — the same rule newSessionInProject follows for the same reason.
    const known = this.store.getProject(targetProjectPath)
    if (!known) throw new Error(`Unknown project: ${targetProjectPath}`)
    const target = await resolveProject(known.path)

    const targetFile = this.source.transcriptPathFor(target.path, sessionId)
    const targetDir = dirname(targetFile)
    if (existsSync(targetFile)) {
      throw new Error(`A session already exists there: ${targetFile}`)
    }

    await mkdir(targetDir, { recursive: true })
    await rename(session.filePath, targetFile)

    this.store.syncProject(target)
    this.store.recordSessionMove(sessionId, target.path, target.path, targetFile)
  }

  async checkConflict(sessionId: string): Promise<ResumeConflict | null> {
    const pid = this.live.get(sessionId)
    return pid === undefined ? null : { sessionId, pid }
  }

  // resume, openShell*, newSessionIn*, forkSession and sendPrompt below are one-line delegates to
  // TerminalService (MAIN-14 step 4) — kept here so ipc/handlers and appService.test.ts do not
  // have to change what they call.

  async resume(sessionId: string): Promise<void> {
    return this.terminals.resume(sessionId)
  }

  /** Whether VS Code was found on this machine at launch. Checked once; does not change at runtime. */
  vsCodeAvailable(): boolean {
    return this.vscode.available()
  }

  /** Opens the session's folder in VS Code. Rejects if VS Code was not found or the folder is gone. */
  async openInVsCode(key: string, isPtyId: boolean): Promise<void> {
    await this.vscode.open(key, isPtyId)
  }

  async openShell(sessionId: string, tabId: string): Promise<void> {
    return this.terminals.openShell(sessionId, tabId)
  }

  async openShellForPty(ptyId: string, tabId: string): Promise<void> {
    return this.terminals.openShellForPty(ptyId, tabId)
  }

  // Every git* method below is a one-line delegate to GitService (MAIN-14 step 3) — kept here so
  // ipc/handlers and appService.test.ts do not have to change what they call.

  async gitStatus(key: string, isPtyId: boolean): Promise<GitStatus | null> {
    return this.git.status(key, isPtyId)
  }

  async gitListRefs(key: string, isPtyId: boolean): Promise<GitRefs> {
    return this.git.listRefs(key, isPtyId)
  }

  async gitlabMrRefStatus(
    key: string, isPtyId: boolean, iids: number[],
  ): Promise<Record<number, MrState | null>> {
    return this.git.mrRefStatus(key, isPtyId, iids)
  }

  async gitCheckoutBranch(key: string, isPtyId: boolean, name: string): Promise<CheckoutOutcome> {
    return this.git.checkoutBranch(key, isPtyId, name)
  }

  /** Pulls `branch` in the worktree that has it, which is the only place it *can* be pulled. */
  async gitPullWorktree(
    key: string, isPtyId: boolean, branch: string,
  ): Promise<{ path: string; commits: number }> {
    return this.git.pullWorktree(key, isPtyId, branch)
  }

  /** Starts a new Claude session in the worktree that has `branch`. */
  async newSessionInWorktree(
    key: string, isPtyId: boolean, branch: string,
  ): Promise<NewSessionInfo> {
    return this.newSessionInFolder(await this.git.requireWorktreeFor(key, isPtyId, branch))
  }

  async gitCheckoutRemote(key: string, isPtyId: boolean, remoteRef: string, localName: string): Promise<void> {
    await this.git.checkoutRemote(key, isPtyId, remoteRef, localName)
  }

  async gitCheckoutDetached(key: string, isPtyId: boolean, ref: string): Promise<void> {
    await this.git.checkoutDetached(key, isPtyId, ref)
  }

  async gitCreateBranch(key: string, isPtyId: boolean, name: string, from?: string): Promise<void> {
    await this.git.createBranch(key, isPtyId, name, from)
  }

  async gitPull(key: string, isPtyId: boolean): Promise<{ commits: number }> {
    return this.git.pull(key, isPtyId)
  }

  /** Fast-forwards any local branch from its upstream (the branch list's pull button). */
  async gitUpdateBranch(key: string, isPtyId: boolean, branch: string): Promise<{ commits: number }> {
    return this.git.updateBranch(key, isPtyId, branch)
  }

  async gitPullFolder(path: string): Promise<{ commits: number }> {
    return this.git.pullFolder(path)
  }

  async listWorktrees(path: string): Promise<FolderWorktree[]> {
    return this.git.listWorktrees(path)
  }

  async gitPush(key: string, isPtyId: boolean): Promise<{ commits: number; published: boolean }> {
    return this.git.push(key, isPtyId)
  }

  async gitMerge(key: string, isPtyId: boolean, ref: string): Promise<void> {
    await this.git.merge(key, isPtyId, ref)
  }

  async gitFetch(key: string, isPtyId: boolean): Promise<void> {
    await this.git.fetch(key, isPtyId)
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

  /**
   * Whether `sessionId` can still be resumed: it must resolve in the store, its transcript file
   * must still exist (it can be deleted by removing the worktree it lived in — see `resume()`
   * above), and its cwd must still exist. Unlike `requireSession`, this never throws — restore
   * calls it once per recorded live session and a stale one is meant to be dropped, not to abort
   * the whole launch.
   */
  sessionIsResumable(sessionId: string): boolean {
    const session = this.store.getSession(sessionId)
    if (session === undefined || session === null) return false
    if (!existsSync(session.filePath)) return false
    return session.cwd !== null && existsSync(session.cwd)
  }

  async dispose(): Promise<void> {
    // Set synchronously, before any await: any refresh loop currently checking
    // `this.pendingRefresh && !this.disposed` in the same tick will see this and stop
    // scheduling further passes, so no fire-and-forget rerun can start after this point.
    this.disposed = true
    await this.pty.killAll()
    // Let any refresh already in flight (or its already-chained rerun) finish before closing
    // the database — otherwise it could try to write through a closed better-sqlite3 handle.
    if (this.refreshPromise) {
      await this.refreshPromise.catch(() => {})
    }
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
    this.autoImportAll = enabled
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
