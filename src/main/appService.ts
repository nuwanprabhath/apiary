import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { projectsDir } from './config'
import { scanProjects } from './scanner/sessionScanner'
import { encodeProjectDirName } from './scanner/projectDirName'
import { resolveProject, clearResolverCache } from './git/worktreeResolver'
import { SessionStore } from './store/sessionStore'
import { buildTree } from './tree/buildTree'
import { indexTranscript, readTranscriptPage } from './transcript/transcriptReader'
import { detectLiveSessions } from './live/liveSessionDetector'
import { PtyManager } from './pty/ptyManager'
import { SearchIndex } from './search/searchIndex'
import { SearchClient } from './search/searchClient'
import { runIndexPass, type IndexableSession } from './search/indexer'
import { promptPathEnv, type PromptPathOptions } from './pty/promptPath'
import { forkLabel } from '@shared/forkLabel'
import { log } from './log/logger'
import { PluginRegistry } from './plugins/registry'
import { createGitLabMrPlugin, originUrl, defaultExec as defaultGitExec } from './plugins/gitlabMr'
import { parseGitLabRemote } from './plugins/gitlabRemote'
import type { PluginBarItem } from './plugins/types'
import { resolveMrStatus, type MrState } from './git/mrStatusCache'
import { buildResumeCommand, buildNewSessionCommand } from './pty/resumeCommand'
import { openInVsCode as spawnVsCode } from './vscode/detectVsCode'
import * as branchOps from './git/branchOps'
import type {
  ProjectNode, ResumeConflict, TranscriptPage, NewSessionInfo, CheckoutOutcome,
} from '@shared/types'
import type { StoredSession } from './store/sessionStore'
import type { SessionMeta, GitStatus, GitRefs } from '@shared/types'

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
}

/**
 * Extensions for the image types worth accepting from a clipboard. The map is also the allow-list:
 * a media type absent from it is refused rather than written to disk under a guessed extension.
 */
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
}

/** Refuse anything larger. A clipboard image this big is a mistake, and the path is sent to a CLI. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

/**
 * Terminal bracketed-paste markers. Sending a multi-line prompt as a *paste* rather than as
 * keystrokes is what stops the receiving TUI treating the first newline as "submit" and firing off
 * a half-written message — the same mechanism a terminal uses when you paste into it by hand.
 */
const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

export class AppService {
  readonly pty = new PtyManager()
  private store: SessionStore
  private options: AppServiceOptions
  private live = new Map<string, number>()
  private refreshPromise: Promise<void> | null = null
  private pendingRefresh = false
  private disposed = false
  private autoImportAll = false
  /**
   * The full-text index, created on first use. Lazy because it is only worth the file handle and
   * the schema when content search is actually on, and it can be switched off in Settings.
   */
  private searchIndex: SearchIndex | null = null
  /** Owns the worker thread the content search runs on — see `searchSessions`. */
  private searchClient: SearchClient | null = null
  private searchChatContent = true
  private searchSessionNotes = true
  private promptPath: PromptPathOptions = { enabled: false, segments: 2 }
  private readonly plugins: PluginRegistry
  /** Set while a pass is running, so refreshes cannot stack passes on top of each other. */
  private indexing = false
  /** Resolved once at construction by `detectVsCode`; never re-probed per hover. */
  private readonly vsCodePath: string | null

  constructor(options: AppServiceOptions) {
    this.options = options
    this.store = new SessionStore(options.dbPath)
    this.autoImportAll = options.autoImportAll ?? false
    this.searchChatContent = options.searchChatContent ?? true
    this.searchSessionNotes = options.searchSessionNotes ?? true
    this.promptPath = options.promptPath ?? { enabled: false, segments: 2 }
    this.vsCodePath = options.vsCodePath ?? null
    this.plugins = new PluginRegistry({ onChanged: () => options.onPluginsChanged?.() })
    this.plugins.register(
      createGitLabMrPlugin({ glabPath: options.glabPath }),
      options.plugins?.['gitlab-mr'] ?? true,
    )
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
      cwd = this.resolveShellCwd(key, isPtyId)
    } catch {
      return null
    }
    return { cwd, branch: this.lastBranch.get(cwd) ?? null }
  }

  /** Which branch each folder was last seen on, filled in by `gitStatus`. */
  private readonly lastBranch = new Map<string, string | null>()

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
    // The exact answer to "I turned the setting on and my prompt is still long": what the app
    // decided, and what it will actually put in the environment.
    log.info('prompt', 'prompt trim configured', {
      enabled: options.enabled,
      segments: options.segments,
      minimal: options.minimal ?? false,
      env: promptPathEnv(options, this.options.zshPromptShim ?? null),
    })
    this.promptPath = options
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
  async refresh(): Promise<void> {
    if (this.refreshPromise) {
      this.pendingRefresh = true
      return this.refreshPromise
    }
    this.refreshPromise = this.runRefreshLoop()
    return this.refreshPromise
  }

  private async runRefreshLoop(): Promise<void> {
    try {
      await this.runRefresh()
    } catch (e) {
      // A rejection must not wedge future refreshes: clear both the in-flight pointer and
      // any pending-rerun request, then propagate the failure to everyone awaiting this run
      // (the original caller and anyone who joined it) exactly as before this fix.
      this.pendingRefresh = false
      this.refreshPromise = null
      throw e
    }
    if (this.pendingRefresh && !this.disposed) {
      this.pendingRefresh = false
      // Chain the rerun onto this same promise so every caller of this run — including one
      // that only joined an in-flight refresh — actually observes a pass that ran after their
      // trigger, not the stale snapshot the joined pass started with.
      this.refreshPromise = this.runRefreshLoop()
      return this.refreshPromise
    }
    this.refreshPromise = null
  }

  private async runRefresh(): Promise<void> {
    clearResolverCache()
    const metas = await scanProjects(projectsDir(this.options.configRoot))

    const byRawCwd = new Map<string, SessionMeta[]>()
    for (const m of metas) {
      if (!m.cwd) continue // Without a cwd there is nothing to group or resume against.
      const list = byRawCwd.get(m.cwd) ?? []
      list.push(m)
      byRawCwd.set(m.cwd, list)
    }

    // Resolve every distinct raw cwd to its canonical project path first, then
    // group by that canonical key. Two JSONL files that record the same
    // directory via different routes (e.g. one through a symlink) must land
    // under one project row, not split across two: resolveProject already
    // canonicalizes with realpath, so syncProject and syncSessions must be
    // keyed on ProjectInfo.path rather than the raw string read from the JSONL.
    const byCanonicalCwd = new Map<string, SessionMeta[]>()
    const infoByCanonicalCwd = new Map<string, Awaited<ReturnType<typeof resolveProject>>>()
    for (const [rawCwd, list] of byRawCwd) {
      const info = await resolveProject(rawCwd)
      infoByCanonicalCwd.set(info.path, info)
      const existing = byCanonicalCwd.get(info.path) ?? []
      existing.push(...list)
      byCanonicalCwd.set(info.path, existing)
    }

    for (const [canonicalCwd, list] of byCanonicalCwd) {
      const info = infoByCanonicalCwd.get(canonicalCwd)
      if (!info) continue
      this.store.syncProject(info)
      this.store.syncSessions(canonicalCwd, list)
    }

    this.live = await (this.options.detectLive ?? detectLiveSessions)()
    // Inside the refresh itself, rather than at each of its callers: the Refresh button, the file
    // watcher and the periodic rescan all arrive here, and a setting called "import everything
    // automatically" that only held for some of those routes would be the worst kind of half-true.
    if (this.autoImportAll) {
      await this.importAllDiscovered()
    }
    // Deliberately not awaited: see updateSearchIndex.
    void this.updateSearchIndex()
  }

  async tree(): Promise<ProjectNode[]> {
    return buildTree(
      this.store.visibleProjects(),
      this.store.visibleSessions(),
      new Set(this.live.keys()),
      (path) => existsSync(path),
    )
  }

  /**
   * Session ids matched by anything other than their title: the conversation, the user's note, or
   * both, according to which of the two are switched on. They are independent — a note is a line
   * the user wrote and costs nothing to keep indexed, so it stays searchable even for someone who
   * has turned transcript indexing off.
   */
  /**
   * Which sessions match `query` by conversation content or by note.
   *
   * Runs in a worker thread (`SearchClient`), not here. `better-sqlite3` is synchronous, so doing
   * this inline put an FTS query on the thread that also routes window input — and a slow query
   * therefore froze typing in every window rather than merely delaying results. See
   * `searchWorker.ts`; the 7.7-second case that proved it is described in `searchIndex.ts`.
   */
  async searchSessions(query: string): Promise<string[]> {
    if (!this.searchChatContent && !this.searchSessionNotes) return []
    this.searchClient ??= new SearchClient(this.searchDbPath())
    const fromWorker = await this.searchClient.search(query, {
      content: this.searchChatContent,
      notes: this.searchSessionNotes,
    })
    if (fromWorker !== null) return fromWorker

    // No worker available — search in-process rather than pretending nothing matched. This blocks
    // the main thread, which is the very thing the worker exists to avoid, so it is a fallback and
    // not a mode: `SearchClient` logs loudly when it cannot start one. It is also the path the
    // integration tests take, since they run the source directly with no bundled worker beside it.
    try {
      const ids = new Set<string>()
      if (this.searchChatContent) {
        for (const hit of this.index().search(query)) ids.add(hit.sessionId)
      }
      if (this.searchSessionNotes) {
        for (const hit of this.index().searchNotes(query)) ids.add(hit.sessionId)
      }
      return [...ids]
    } catch {
      // Search is an enhancement to the sidebar, never a reason for it to fail to load.
      return []
    }
  }

  private searchDbPath(): string {
    return this.options.searchDbPath ?? join(dirname(this.options.dbPath), 'search.db')
  }

  /** The index, opened on first use. */
  private index(): SearchIndex {
    this.searchIndex ??= new SearchIndex(this.searchDbPath())
    return this.searchIndex
  }

  setSearchChatContent(enabled: boolean): void {
    // Anything that is not a boolean is a caller that does not know about this setting, not a
    // request to turn it off. See the note on the settings merge in ipc.ts.
    if (typeof enabled !== 'boolean') return
    this.searchChatContent = enabled
  }

  /**
   * Turns note indexing on or off.
   *
   * Switching it off empties the note index rather than merely ignoring it — a search index of
   * things the user asked not to be searched should not sit on disk. Switching it back on
   * repopulates from the session store, which is the record of the notes themselves; this is
   * immediate and cheap, because a note is a line of text and no transcript has to be re-read.
   */
  setSearchSessionNotes(enabled: boolean): void {
    // Guarded before the comparison, because the damage here is not just a flag: switching off
    // empties the note index, so a stray `undefined` would silently delete it.
    if (typeof enabled !== 'boolean') return
    if (enabled === this.searchSessionNotes) return
    this.searchSessionNotes = enabled
    try {
      if (!enabled) this.index().clearNotes()
      else this.syncNoteIndex()
    } catch {
      // The note index is derived data; failing to reshape it must not fail the settings save.
    }
  }

  /** Rewrites the note index from the store — used when note indexing is switched back on. */
  private syncNoteIndex(): void {
    const index = this.index()
    index.clearNotes()
    for (const { sessionId, note } of this.store.sessionsWithNotes()) index.putNote(sessionId, note)
  }

  /**
   * Saves the user's note for a session, and keeps the index in step with it.
   *
   * The index write happens here rather than being left to the next background pass: a note is
   * written so it can be found again, and a note that is not searchable until some later rescan
   * is a note that appears not to work.
   */
  async setSessionNote(sessionId: string, note: string): Promise<void> {
    this.requireSession(sessionId)
    const trimmed = note.trim()
    this.store.setNote(sessionId, trimmed === '' ? null : trimmed)
    if (this.searchSessionNotes) {
      try {
        this.index().putNote(sessionId, trimmed === '' ? null : trimmed)
      } catch {
        // Saved either way: the note lives in the session store, and a rebuild recovers the index.
      }
    }
  }

  /** The note for one session, for the editor to open with what is already there. */
  sessionNote(sessionId: string): string {
    return this.store.allSessions().find((s) => s.sessionId === sessionId)?.note ?? ''
  }

  /** Wipes the index so the next pass rebuilds it — the "Rebuild index" action in Settings. */
  async rebuildSearchIndex(): Promise<void> {
    if (!this.searchChatContent && !this.searchSessionNotes) return
    this.index().clear()
    // Notes come back from the store immediately; transcripts are the slow part and are left to
    // the pass below.
    if (this.searchSessionNotes) this.syncNoteIndex()
    await this.updateSearchIndex()
  }

  /** How many sessions are indexed, for Settings to show that the index exists and is populated. */
  searchIndexCount(): number {
    return this.searchChatContent ? this.index().count() : 0
  }

  /** How many notes are indexed, shown beside the session count in Settings. */
  searchNoteCount(): number {
    return this.searchSessionNotes ? this.index().noteCount() : 0
  }

  /**
   * Brings the index up to date for every imported session.
   *
   * Never awaited by `refresh()`: indexing is a background chore, and a rescan that waited for it
   * would make the Refresh button as slow as the slowest thing in the index. The `indexing` guard
   * means overlapping refreshes queue no work rather than racing each other over the same files.
   */
  async updateSearchIndex(): Promise<void> {
    // Notes are kept in step by whoever changes them, but a pass is also where a note written
    // before indexing was switched on gets picked up.
    if (this.searchSessionNotes && !this.disposed) {
      try { this.syncNoteIndex() } catch { /* Derived data; the next pass tries again. */ }
    }
    if (!this.searchChatContent || this.indexing || this.disposed) return
    this.indexing = true
    try {
      const sessions: IndexableSession[] = this.store
        .visibleSessions()
        .map((s) => ({ sessionId: s.sessionId, file: s.filePath }))
      const result = await runIndexPass(
        this.index(), sessions, () => this.disposed || !this.searchChatContent,
      )
      if (result.indexed > 0 && !this.disposed) this.options.onIndexUpdated?.()
    } catch {
      // A failed pass leaves the index as it was; the next refresh tries again.
    } finally {
      this.indexing = false
    }
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
   */
  async importSessions(sessionIds: string[], autoImportProjects: string[]): Promise<void> {
    this.store.setImported(sessionIds, true)
    for (const path of autoImportProjects) {
      const info = await resolveProject(path)
      this.store.setAutoImport(info.path, true)
    }
  }

  async transcript(sessionId: string, beforeIndex?: number): Promise<TranscriptPage> {
    const session = this.requireSession(sessionId)
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
    this.requireSession(sessionId)
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
    this.requireSession(sessionId)
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
    const session = this.requireSession(sessionId)
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

    const targetDir = join(projectsDir(this.options.configRoot), encodeProjectDirName(target.path))
    const targetFile = join(targetDir, `${sessionId}.jsonl`)
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

  /**
   * Spawns `claude --resume` in the session's recorded cwd. Terminal id is the session id.
   *
   * **An already-running pty is attached to, never replaced.** The same session can legitimately
   * be live in two windows at once (see `checkConflict`'s own comment on the class), and each
   * window is a separate renderer that cannot see what another one has already started — this is
   * exactly what surfaced restoring after a relaunch: both windows recorded the session as `live`
   * at quit, both call `resume()` independently on mount, and without this check the second call
   * would hit `spawn()`'s unconditional `kill()` and restart the pty out from under the first
   * window mid-startup. `this.pty.has` is the same check `openShell` already makes for the
   * equivalent shell-tab collision.
   */
  async resume(sessionId: string): Promise<void> {
    if (this.pty.has(sessionId)) {
      log.info('resume', 'attaching to a session that is already running', { sessionId })
      return
    }
    const session = this.requireSession(sessionId)
    const cwd = session.cwd
    if (!cwd || !existsSync(cwd)) {
      throw new Error(`The folder for this session no longer exists: ${cwd ?? 'unknown'}`)
    }
    this.pty.spawn({
      id: sessionId,
      cwd,
      command: buildResumeCommand(sessionId, { claudeBin: this.options.claudeBin }),
      tui: true,
      // Claude takes the screen, so its own prompt is not bash's — but the shell is still there
      // underneath and is what you are left looking at the moment Claude exits, which is where a
      // 90-column worktree path greets you. This was missed when the setting was added: it reached
      // the shell tabs and not the session's own terminal, so the setting looked broken to anyone
      // who tried it on the terminal they actually use.
      env: promptPathEnv(this.promptPath, this.options.zshPromptShim ?? null),
    })
  }

  /**
   * Resolves a session id or (when `isPtyId`) a still-pending session's pty id to its real,
   * existing cwd — the one trust boundary every cwd-carrying IPC call (shells, and now git
   * operations) goes through, so the renderer never gets to hand in a raw filesystem path.
   */
  private resolveShellCwd(key: string, isPtyId: boolean): string {
    const cwd = isPtyId ? this.pty.getCwd(key) : this.requireSession(key).cwd
    if (!cwd) throw new Error(`Unknown session: ${key}`)
    if (!existsSync(cwd)) throw new Error(`The folder for this session no longer exists: ${cwd}`)
    return cwd
  }

  /** Whether VS Code was found on this machine at launch. Checked once; does not change at runtime. */
  vsCodeAvailable(): boolean {
    return this.vsCodePath !== null
  }

  /** Opens the session's folder in VS Code. Rejects if VS Code was not found or the folder is gone. */
  async openInVsCode(key: string, isPtyId: boolean): Promise<void> {
    if (this.vsCodePath === null) throw new Error('VS Code was not found on this machine')
    const cwd = this.resolveShellCwd(key, isPtyId)
    spawnVsCode(this.vsCodePath, cwd)
  }

  /**
   * Spawns a plain interactive shell in the session's cwd, keyed `shell:<id>:<tabId>` — more
   * than one tab can exist per session; each is addressed by its own tabId.
   *
   * **An existing shell is attached to, never replaced.** Shell tab ids are minted per window and
   * the first one is always `1`, so opening the shell for a session that is already open in
   * another window asked for the id that window was using — and `spawn()` kills whatever is under
   * an id before taking it. A build, a `tail -f`, an editor, anything running in the first
   * window's shell died the moment the second window showed the same session, with nothing said.
   * Attaching is now a real answer rather than a blank pane, because the pty keeps a replay buffer
   * for a view that arrives late (see `PtyManager.replay`).
   */
  async openShell(sessionId: string, tabId: string): Promise<void> {
    const id = `shell:${sessionId}:${tabId}`
    if (this.pty.has(id)) {
      log.info('shell', 'attaching to a shell that is already running', { id })
      return
    }
    const cwd = this.resolveShellCwd(sessionId, false)
    this.pty.spawn({
      id,
      cwd,
      command: 'exec "$SHELL" -l',
      env: promptPathEnv(this.promptPath, this.options.zshPromptShim ?? null),
    })
  }

  /**
   * Same as `openShell`, but for a new session's pty before it has a real session id yet, keyed
   * `shell:<ptyId>:<tabId>`.
   */
  async openShellForPty(ptyId: string, tabId: string): Promise<void> {
    const id = `shell:${ptyId}:${tabId}`
    if (this.pty.has(id)) return
    const cwd = this.resolveShellCwd(ptyId, true)
    this.pty.spawn({
      id,
      cwd,
      command: 'exec "$SHELL" -l',
      env: promptPathEnv(this.promptPath, this.options.zshPromptShim ?? null),
    })
  }

  async gitStatus(key: string, isPtyId: boolean): Promise<GitStatus> {
    const cwd = this.resolveShellCwd(key, isPtyId)
    const status = await branchOps.status(cwd)
    // Plugins are asked about a branch, and this is where the branch is already being read — so
    // the bar's own polling is what keeps them current, with no second `git` call of their own.
    this.lastBranch.set(cwd, status.branch)
    return status
  }

  async gitListRefs(key: string, isPtyId: boolean): Promise<GitRefs> {
    return branchOps.listRefs(this.resolveShellCwd(key, isPtyId))
  }

  /**
   * Resolves each `!<iid>` reference named in a session's title or note against its GitLab
   * remote, the way the session-bar plugin resolves its own button: through `glab`, never a
   * stored token. No remote, no `glab`, a non-zero exit or a timeout all map every iid to `null`
   * rather than throwing — an unresolved reference is meant to render exactly as if this call
   * had never been made.
   */
  async gitlabMrRefStatus(
    key: string, isPtyId: boolean, iids: number[],
  ): Promise<Record<number, MrState | null>> {
    const cwd = this.resolveShellCwd(key, isPtyId)
    const out: Record<number, MrState | null> = {}
    const remoteUrl = await originUrl(cwd, defaultGitExec)
    const remote = remoteUrl === null ? null : parseGitLabRemote(remoteUrl)
    if (remote === null) {
      for (const iid of iids) out[iid] = null
      return out
    }
    await Promise.all(iids.map(async (iid) => {
      out[iid] = await resolveMrStatus(cwd, remote.host, remote.project, iid, { glabPath: this.options.glabPath })
    }))
    return out
  }

  /**
   * Checks out a branch, reporting the one failure that is not really a failure.
   *
   * Git refuses to check out a branch that another worktree already has, and says so in prose. On
   * a repository with a worktree per ticket that is the *normal* answer, not an error: the branch
   * exists and is up the road in another directory. Returning it as an outcome lets the UI offer
   * the two things wanted at that point — update it where it lives, or open a session there —
   * instead of printing git's sentence and leaving the user to go and find the folder.
   *
   * The worktree's path is looked up with `git worktree list --porcelain` rather than scraped out
   * of the message. The message is English and quoted; the porcelain output is an interface. It
   * also keeps the rule that a path the app later acts on is one the main process derived itself.
   */
  async gitCheckoutBranch(key: string, isPtyId: boolean, name: string): Promise<CheckoutOutcome> {
    const cwd = this.resolveShellCwd(key, isPtyId)
    try {
      await branchOps.checkoutBranch(cwd, name)
      return { ok: true }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (!branchOps.isWorktreeConflict(message)) throw e
      const worktreePath = await branchOps.worktreeForBranch(cwd, name)
      log.info('git', 'checkout refused: branch is in another worktree', {
        branch: name, cwd, worktreePath,
      })
      // Git said a worktree has it but the list does not agree — rather than invent an answer,
      // let the original error through, which at least says what git said.
      if (worktreePath === null) throw e
      return { ok: false, conflict: { branch: name, worktreePath, label: basename(worktreePath) } }
    }
  }

  /**
   * Resolves the worktree holding `branch`, for the two follow-ups a conflict offers.
   *
   * The renderer names the *branch*, never the path: this is the same trust boundary every other
   * cwd-carrying call goes through, and the answer is re-derived each time because a worktree can
   * be removed between the refusal and the click.
   */
  private async requireWorktreeFor(key: string, isPtyId: boolean, branch: string): Promise<string> {
    const cwd = this.resolveShellCwd(key, isPtyId)
    const path = await branchOps.worktreeForBranch(cwd, branch)
    if (path === null) {
      throw new Error(`${branch} is no longer checked out in a worktree of this repository`)
    }
    if (!existsSync(path)) throw new Error(`That worktree no longer exists: ${path}`)
    return path
  }

  /** Pulls `branch` in the worktree that has it, which is the only place it *can* be pulled. */
  async gitPullWorktree(
    key: string, isPtyId: boolean, branch: string,
  ): Promise<{ path: string; commits: number }> {
    const path = await this.requireWorktreeFor(key, isPtyId, branch)
    const { commits } = await branchOps.pull(path)
    return { path, commits }
  }

  /** Starts a new Claude session in the worktree that has `branch`. */
  async newSessionInWorktree(
    key: string, isPtyId: boolean, branch: string,
  ): Promise<NewSessionInfo> {
    return this.newSessionInFolder(await this.requireWorktreeFor(key, isPtyId, branch))
  }

  async gitCheckoutRemote(key: string, isPtyId: boolean, remoteRef: string, localName: string): Promise<void> {
    await branchOps.checkoutRemote(this.resolveShellCwd(key, isPtyId), remoteRef, localName)
  }

  async gitCheckoutDetached(key: string, isPtyId: boolean, ref: string): Promise<void> {
    await branchOps.checkoutDetached(this.resolveShellCwd(key, isPtyId), ref)
  }

  async gitCreateBranch(key: string, isPtyId: boolean, name: string, from?: string): Promise<void> {
    await branchOps.createBranch(this.resolveShellCwd(key, isPtyId), name, from)
  }

  async gitPull(key: string, isPtyId: boolean): Promise<{ commits: number }> {
    return branchOps.pull(this.resolveShellCwd(key, isPtyId))
  }

  /** Fast-forwards any local branch from its upstream (the branch list's pull button). */
  async gitUpdateBranch(key: string, isPtyId: boolean, branch: string): Promise<{ commits: number }> {
    return branchOps.updateBranch(this.resolveShellCwd(key, isPtyId), branch)
  }

  /**
   * Fast-forwards a folder's branch from its upstream — the pull button on a folder's hover card.
   * `path` comes from the renderer, so it is checked against a stored project row before git
   * runs anywhere, the same rule `newSessionInProject` keeps.
   */
  async gitPullFolder(path: string): Promise<{ commits: number }> {
    const project = this.store.getProject(path)
    if (!project) throw new Error(`Unknown project: ${path}`)
    return branchOps.pullFastForward(project.path)
  }

  async gitPush(key: string, isPtyId: boolean): Promise<{ commits: number; published: boolean }> {
    return branchOps.push(this.resolveShellCwd(key, isPtyId))
  }

  async gitMerge(key: string, isPtyId: boolean, ref: string): Promise<void> {
    await branchOps.merge(this.resolveShellCwd(key, isPtyId), ref)
  }

  async gitFetch(key: string, isPtyId: boolean): Promise<void> {
    await branchOps.fetch(this.resolveShellCwd(key, isPtyId))
  }

  /**
   * Starts a brand-new (non-`--resume`) session in a project the store already knows about.
   * `path` comes from the renderer, so it is validated against a stored project row rather than
   * trusted directly — an unknown path is rejected before it ever reaches `PtyManager`, the same
   * invariant every other path-carrying IPC call preserves.
   */
  async newSessionInProject(path: string): Promise<NewSessionInfo> {
    const project = this.store.getProject(path)
    if (!project) throw new Error(`Unknown project: ${path}`)
    return this.startNewSession(project.path)
  }

  /**
   * Starts a brand-new session in an arbitrary folder. Only safe to call with a path the main
   * process obtained itself (the native folder-picker dialog) — never with a string handed in
   * by the renderer. The folder may be entirely new to Apiary, so its project row is created
   * (or refreshed) first.
   */
  async newSessionInFolder(path: string): Promise<NewSessionInfo> {
    if (!existsSync(path)) throw new Error(`Folder does not exist: ${path}`)
    const info = await resolveProject(path)
    this.store.syncProject(info)
    return this.startNewSession(info.path)
  }

  /**
   * Forks a session: starts `claude --resume <id> --fork-session`, which replays the conversation
   * so far into a *new* session rather than continuing the old one.
   *
   * Deliberately routed through the same `new:<uuid>` pty bookkeeping as starting a session from
   * scratch, not through `resume()`. A fork's session id does not exist yet — Claude mints it and
   * writes the JSONL itself — so there is nothing to key the terminal by until the watcher finds
   * it, which is exactly the problem the pending-session machinery already solves. The one thing
   * that differs is the label, and the renderer carries that across as a rename once the real id
   * appears.
   *
   * The original is untouched, which is the point of forking rather than branching in place: the
   * conversation you forked from is still there to go back to.
   */
  forkSession(sessionId: string): NewSessionInfo {
    const session = this.requireSession(sessionId)
    const cwd = session.cwd
    if (!cwd || !existsSync(cwd)) {
      throw new Error(`The folder for this session no longer exists: ${cwd ?? 'unknown'}`)
    }
    this.store.setAutoImport(cwd, true)
    const ptyId = `new:${randomUUID()}`
    this.pty.spawn({
      id: ptyId,
      cwd,
      command: buildResumeCommand(sessionId, { fork: true, claudeBin: this.options.claudeBin }),
      tui: true,
      env: promptPathEnv(this.promptPath, this.options.zshPromptShim ?? null),
    })
    return { ptyId, cwd, label: forkLabel(session.title ?? (basename(cwd) || cwd)) }
  }

  /**
   * Spawns `claude` (no `--resume`) in `cwd`, keyed under a fresh `new:<uuid>` pty id — there is
   * no session id yet, so it cannot be keyed like `resume()`/`openShell()` are. Also flips the
   * project's `auto_import` flag so the session the watcher discovers once Claude writes its
   * JSONL (and any future session started in this folder) shows up in the sidebar on its own,
   * the same mechanism ticking a folder header in the import dialog already uses.
   */
  private startNewSession(cwd: string): NewSessionInfo {
    if (!existsSync(cwd)) throw new Error(`Working directory does not exist: ${cwd}`)
    this.store.setAutoImport(cwd, true)
    const ptyId = `new:${randomUUID()}`
    this.pty.spawn({
      id: ptyId,
      cwd,
      command: buildNewSessionCommand({ claudeBin: this.options.claudeBin }),
      tui: true,
      env: promptPathEnv(this.promptPath, this.options.zshPromptShim ?? null),
    })
    return { ptyId, cwd, label: basename(cwd) || cwd }
  }

  private requireSession(sessionId: string): StoredSession {
    const session = this.store.getSession(sessionId)
    if (!session) throw new Error(`Unknown session: ${sessionId}`)
    return session
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
    // `disposed` already tells a running index pass to stop between files, so this waits on
    // nothing: the worst case is one file's read finishing against a handle about to close.
    this.searchIndex?.close()
    this.searchIndex = null
  }

  /** The configured `claude`, or null for "find it on PATH" — the theme generator runs the same one. */
  get claudeBin(): string | null {
    return this.options.claudeBin ?? null
  }

  setClaudeBin(path: string | null): void {
    this.options = { ...this.options, claudeBin: path ?? undefined }
  }

  setAutoImportAll(enabled: boolean): void {
    this.autoImportAll = enabled
  }

  /** Where pasted images live. Beside the database, so it travels with the rest of the app's data. */
  private imagesDir(): string {
    return this.options.imagesDir ?? join(dirname(this.options.dbPath), 'pasted-images')
  }

  /**
   * Writes an image pasted into the composer to disk and returns its absolute path.
   *
   * On disk rather than inlined into the message because the path is what actually reaches Claude:
   * it reads the file itself. Kept in Apiary's own data directory rather than the session's working
   * directory so that pasting a screenshot never leaves untracked files in someone's repository.
   */
  async saveImage(base64: string, mediaType: string): Promise<string> {
    const extension = IMAGE_EXTENSIONS[mediaType]
    if (extension === undefined) throw new Error(`Unsupported image type: ${mediaType}`)
    const bytes = Buffer.from(base64, 'base64')
    if (bytes.byteLength === 0) throw new Error('That image was empty.')
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`That image is ${String(Math.round(bytes.byteLength / 1024 / 1024))}MB; the limit is 20MB.`)
    }
    const dir = this.imagesDir()
    await mkdir(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const path = join(dir, `${stamp}-${randomUUID().slice(0, 8)}${extension}`)
    await writeFile(path, bytes)
    return path
  }

  /**
   * Reads one previously-saved image back as a data URL, for the thumbnails and the lightbox.
   *
   * Confined to the images directory, deliberately: the renderer supplies this path (it reads them
   * out of transcript text), and an unconstrained "read this file as a data URL" call handed to the
   * renderer would be a way to exfiltrate any file the app can see. Paths are resolved before the
   * check so `..` cannot climb out.
   */
  async readImage(path: string): Promise<{ dataUrl: string } | null> {
    const dir = resolve(this.imagesDir())
    const full = resolve(path)
    if (full !== dir && !full.startsWith(dir + sep)) return null
    const mediaType = Object.entries(IMAGE_EXTENSIONS)
      .find(([, ext]) => ext === extname(full).toLowerCase())?.[0]
    if (mediaType === undefined) return null
    try {
      const bytes = await readFile(full)
      return { dataUrl: `data:${mediaType};base64,${bytes.toString('base64')}` }
    } catch {
      // A pasted image the user has since deleted is not an error worth interrupting them over —
      // the thumbnail simply doesn't render.
      return null
    }
  }

  /**
   * Delivers a composed prompt to a session's running `claude` process.
   *
   * Wrapped in bracketed-paste markers so the whole thing arrives as one paste: without them a
   * multi-line message submits at its first newline, sending a fragment and leaving the rest to be
   * interpreted as new prompts. The trailing carriage return is the actual "send".
   *
   * Both waits are load-bearing, and both were found by measuring a real `claude` rather than
   * reasoning about it:
   *
   * - Before the paste, because sending a message resumes a stopped session first, and the pty
   *   exists a good second before `claude` is listening. Written into that gap, the message is
   *   swallowed by the terminal's line discipline instead (see `whenQuiet`) — it appears in the
   *   input box, unsent, with its return turned into a newline, and needs an Enter by hand.
   * - Before the return, because it only counts as "submit" once the TUI has taken the paste in.
   *   Measured at ~20ms on an idle session but ~90ms on a busy one, so a fixed delay is a guess;
   *   waiting for the TUI to stop drawing is the thing that was actually being guessed at.
   */
  async sendPrompt(ptyId: string, text: string): Promise<void> {
    if (!this.pty.has(ptyId)) throw new Error('This session is not running.')
    const normalised = text.replace(/\r\n/g, '\n').replace(/\s+$/, '')
    if (normalised === '') return
    await this.pty.whenQuiet(ptyId, { quietMs: 250, capMs: 20_000 })
    const before = this.pty.outputCount(ptyId)
    this.pty.write(ptyId, PASTE_START + normalised + PASTE_END)
    await this.pty.whenQuiet(ptyId, { quietMs: 150, capMs: 1500, after: before })
    this.pty.write(ptyId, '\r')
  }
}
