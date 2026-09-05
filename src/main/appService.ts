import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { projectsDir } from './config'
import { scanProjects } from './scanner/sessionScanner'
import { resolveProject, clearResolverCache } from './git/worktreeResolver'
import { SessionStore } from './store/sessionStore'
import { buildTree, filterTree } from './tree/buildTree'
import { indexTranscript, readTranscriptPage } from './transcript/transcriptReader'
import { detectLiveSessions } from './live/liveSessionDetector'
import { PtyManager } from './pty/ptyManager'
import { buildResumeCommand, buildNewSessionCommand } from './pty/resumeCommand'
import type { ProjectNode, ResumeConflict, TranscriptPage, NewSessionInfo } from '@shared/types'
import type { StoredSession } from './store/sessionStore'
import type { SessionMeta } from '@shared/types'

export interface AppServiceOptions {
  configRoot: string
  dbPath: string
  detectLive?: () => Promise<Map<string, number>>
  claudeBin?: string
}

export class AppService {
  readonly pty = new PtyManager()
  private store: SessionStore
  private options: AppServiceOptions
  private live = new Map<string, number>()
  private refreshPromise: Promise<void> | null = null
  private pendingRefresh = false
  private disposed = false

  constructor(options: AppServiceOptions) {
    this.options = options
    this.store = new SessionStore(options.dbPath)
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
  }

  async tree(query = ''): Promise<ProjectNode[]> {
    const full = buildTree(
      this.store.visibleProjects(),
      this.store.visibleSessions(),
      new Set(this.live.keys()),
      (path) => existsSync(path),
    )
    return filterTree(full, query)
  }

  async discovered(): Promise<StoredSession[]> {
    return this.store.allSessions()
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
    })
  }

  /** Spawns a plain interactive shell in the session's cwd, keyed `shell:<id>`. */
  async openShell(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId)
    const cwd = session.cwd
    if (!cwd || !existsSync(cwd)) {
      throw new Error(`The folder for this session no longer exists: ${cwd ?? 'unknown'}`)
    }
    this.pty.spawn({ id: `shell:${sessionId}`, cwd, command: 'exec "$SHELL" -l' })
  }

  /**
   * Spawns a plain interactive shell alongside a not-yet-resolved new session's pty, keyed
   * `shell:<ptyId>`. `ptyId` never carries the cwd itself across IPC — it is looked up from the
   * already-running pty `PtyManager` spawned it with, the same trust boundary `openShell` keeps
   * for a stored session's cwd (no raw filesystem path is ever accepted from the renderer).
   */
  async openShellForPty(ptyId: string): Promise<void> {
    const cwd = this.pty.getCwd(ptyId)
    if (!cwd) throw new Error(`Unknown session: ${ptyId}`)
    if (!existsSync(cwd)) {
      throw new Error(`The folder for this session no longer exists: ${cwd}`)
    }
    this.pty.spawn({ id: `shell:${ptyId}`, cwd, command: 'exec "$SHELL" -l' })
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
  }

  setClaudeBin(path: string | null): void {
    this.options = { ...this.options, claudeBin: path ?? undefined }
  }
}
