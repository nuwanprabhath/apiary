import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { projectsDir } from './config'
import { scanProjects } from './scanner/sessionScanner'
import { resolveProject, clearResolverCache } from './git/worktreeResolver'
import { SessionStore } from './store/sessionStore'
import { buildTree, filterTree } from './tree/buildTree'
import { indexTranscript, readTranscriptPage } from './transcript/transcriptReader'
import { detectLiveSessions } from './live/liveSessionDetector'
import { PtyManager } from './pty/ptyManager'
import { SearchIndex } from './search/searchIndex'
import { runIndexPass, type IndexableSession } from './search/indexer'
import { buildResumeCommand, buildNewSessionCommand } from './pty/resumeCommand'
import * as branchOps from './git/branchOps'
import type { ProjectNode, ResumeConflict, TranscriptPage, NewSessionInfo } from '@shared/types'
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
  private searchChatContent = true
  /** Set while a pass is running, so refreshes cannot stack passes on top of each other. */
  private indexing = false

  constructor(options: AppServiceOptions) {
    this.options = options
    this.store = new SessionStore(options.dbPath)
    this.autoImportAll = options.autoImportAll ?? false
    this.searchChatContent = options.searchChatContent ?? true
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

  async tree(query = ''): Promise<ProjectNode[]> {
    const full = buildTree(
      this.store.visibleProjects(),
      this.store.visibleSessions(),
      new Set(this.live.keys()),
      (path) => existsSync(path),
    )
    // Title matching happens in the tree itself; the index contributes the sessions whose
    // *contents* match, which are then kept by the same filter. Searching content is additive —
    // it can only widen what a query finds, never hide something the title already matched.
    const byContent = query.trim() === '' ? new Set<string>() : new Set(this.searchSessions(query))
    return filterTree(full, query, byContent)
  }

  /** Session ids whose conversation matches, or none when content search is off. */
  searchSessions(query: string): string[] {
    if (!this.searchChatContent) return []
    try {
      return this.index().search(query).map((hit) => hit.sessionId)
    } catch {
      // Search is an enhancement to the sidebar, never a reason for it to fail to load.
      return []
    }
  }

  /** The index, opened on first use. */
  private index(): SearchIndex {
    this.searchIndex ??= new SearchIndex(
      this.options.searchDbPath ?? join(dirname(this.options.dbPath), 'search.db'),
    )
    return this.searchIndex
  }

  setSearchChatContent(enabled: boolean): void {
    this.searchChatContent = enabled
  }

  /** Wipes the index so the next pass rebuilds it — the "Rebuild index" action in Settings. */
  async rebuildSearchIndex(): Promise<void> {
    if (!this.searchChatContent) return
    this.index().clear()
    await this.updateSearchIndex()
  }

  /** How many sessions are indexed, for Settings to show that the index exists and is populated. */
  searchIndexCount(): number {
    return this.searchChatContent ? this.index().count() : 0
  }

  /**
   * Brings the index up to date for every imported session.
   *
   * Never awaited by `refresh()`: indexing is a background chore, and a rescan that waited for it
   * would make the Refresh button as slow as the slowest thing in the index. The `indexing` guard
   * means overlapping refreshes queue no work rather than racing each other over the same files.
   */
  async updateSearchIndex(): Promise<void> {
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

  async checkConflict(sessionId: string): Promise<ResumeConflict | null> {
    const pid = this.live.get(sessionId)
    return pid === undefined ? null : { sessionId, pid }
  }

  /** Spawns `claude --resume` in the session's recorded cwd. Terminal id is the session id. */
  async resume(sessionId: string, fork: boolean): Promise<void> {
    const session = this.requireSession(sessionId)
    const cwd = session.cwd
    if (!cwd || !existsSync(cwd)) {
      throw new Error(`The folder for this session no longer exists: ${cwd ?? 'unknown'}`)
    }
    this.pty.spawn({
      id: sessionId,
      cwd,
      command: buildResumeCommand(sessionId, { fork, claudeBin: this.options.claudeBin }),
      tui: true,
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

  /** Spawns a plain interactive shell in the session's cwd, keyed `shell:<id>:<tabId>` — more
   *  than one tab can exist per session; each is addressed by its own tabId. */
  async openShell(sessionId: string, tabId: string): Promise<void> {
    const cwd = this.resolveShellCwd(sessionId, false)
    this.pty.spawn({ id: `shell:${sessionId}:${tabId}`, cwd, command: 'exec "$SHELL" -l' })
  }

  /**
   * Same as `openShell`, but for a new session's pty before it has a real session id yet, keyed
   * `shell:<ptyId>:<tabId>`.
   */
  async openShellForPty(ptyId: string, tabId: string): Promise<void> {
    const cwd = this.resolveShellCwd(ptyId, true)
    this.pty.spawn({ id: `shell:${ptyId}:${tabId}`, cwd, command: 'exec "$SHELL" -l' })
  }

  async gitStatus(key: string, isPtyId: boolean): Promise<GitStatus> {
    return branchOps.status(this.resolveShellCwd(key, isPtyId))
  }

  async gitListRefs(key: string, isPtyId: boolean): Promise<GitRefs> {
    return branchOps.listRefs(this.resolveShellCwd(key, isPtyId))
  }

  async gitCheckoutBranch(key: string, isPtyId: boolean, name: string): Promise<void> {
    await branchOps.checkoutBranch(this.resolveShellCwd(key, isPtyId), name)
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

  async gitPull(key: string, isPtyId: boolean): Promise<void> {
    await branchOps.pull(this.resolveShellCwd(key, isPtyId))
  }

  async gitPush(key: string, isPtyId: boolean): Promise<void> {
    await branchOps.push(this.resolveShellCwd(key, isPtyId))
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
    })
    return { ptyId, cwd, label: basename(cwd) || cwd }
  }

  private requireSession(sessionId: string): StoredSession {
    const session = this.store.getSession(sessionId)
    if (!session) throw new Error(`Unknown session: ${sessionId}`)
    return session
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
