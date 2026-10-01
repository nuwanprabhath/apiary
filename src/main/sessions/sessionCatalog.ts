/*
 * SessionCatalog (MAIN-14 step 5) - design note.
 *
 * What it owns: the `live` map (session id -> pid of an external claude process, from
 * `detectLive`), the refresh state machine, and the sidebar read model (tree, discovered, import*).
 *
 * `live` ownership. Written in exactly one place: the end of `runRefresh`, as a whole-map
 * replacement after the store sync (never mutated in place, so a reader sees either the old or the
 * new snapshot). Everyone else reads through `isLive`/`checkConflict`/`tree()`: SessionActions
 * (remove/move guards) and the tree. It reflects only the last *refresh*, which is why
 * `moveSession` also consults the pty manager (a process this app spawned is live before the next
 * scan notices it).
 *
 * Refresh states (`refreshPromise` x `pendingRefresh`):
 *   idle          promise null, pending null -> refresh() starts a loop, state = running
 *   running       promise set,  pending null -> refresh() joins the promise and records a pending
 *                                               request, state = rerun-queued
 *   rerun-queued  promise set,  pending set  -> refresh() merges into pending (full wins, else
 *                                               union of paths) and joins; when the pass ends the
 *                                               loop takes pending, clears it and chains ONE more
 *                                               pass onto the SAME promise (state = running again)
 *   A failed pass clears both fields (back to idle) and rejects every awaiter. A pass that ends
 *   with nothing pending sets the promise to null (idle). Once `isDisposed()` is true no rerun is
 *   scheduled and passes bail between steps. It is a single flag, not a queue: no backlog. Passes
 *   are serialised: two never overlap (resolver cache clearing, store writes).
 *   `whenIdle()` awaits the current promise (including chained reruns) and swallows its failure;
 *   AppService.dispose() uses it so the store is not closed under a running pass.
 */
import { existsSync } from 'node:fs'
import { extractMeta } from '../scanner/sessionScanner'
import type { SessionSource } from '../sources/claudeProjects'
import { resolveProject, clearResolverCache, resetResolverSpawnCount, resolverSpawnCount } from '../git/worktreeResolver'
import type { SessionStore, StoredSession } from '../store/sessionStore'
import { buildTree } from '../tree/buildTree'
import { detectLiveSessions } from '../claude/live/liveSessionDetector'
import { log } from '../log/logger'
import { memoize } from '../util/memoize'
import type { ProjectNode, ResumeConflict, SessionMeta, ProjectInfo } from '@shared/types'
import type { SessionId } from '@shared/domain/ids'

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

export interface SessionCatalogOptions {
  store: SessionStore
  source: SessionSource
  /** Defaults to the real process scan. */
  detectLive?: () => Promise<Map<string, number>>
  autoImportAll?: boolean
  /** True once shutdown has started; passes stop scheduling and writing. */
  isDisposed: () => boolean
  /** Fire-and-forget search index update at the end of a pass (see AppService.updateSearchIndex). */
  updateSearchIndex: () => Promise<void>
}

export class SessionCatalog {
  private live = new Map<string, number>()
  private refreshPromise: Promise<void> | null = null
  /** Set while a pass is in flight, so the trigger that arrived mid-pass is not silently lost -
   *  see `refresh()`. `full` always wins when merging two pending requests. */
  private pendingRefresh: RefreshRequest | null = null
  private autoImportAll: boolean
  private readonly store: SessionStore
  private readonly source: SessionSource
  private readonly opts: SessionCatalogOptions

  constructor(options: SessionCatalogOptions) {
    this.opts = options
    this.store = options.store
    this.source = options.source
    this.autoImportAll = options.autoImportAll ?? false
  }

  setAutoImportAll(enabled: boolean): void {
    this.autoImportAll = enabled
  }

  isLive(sessionId: string): boolean {
    return this.live.has(sessionId)
  }

  /** Resolves when no refresh is in flight (including any chained rerun). Never rejects. */
  async whenIdle(): Promise<void> {
    if (this.refreshPromise) await this.refreshPromise.catch(() => {})
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
    if (this.pendingRefresh && !this.opts.isDisposed()) {
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
        if (this.opts.isDisposed()) return
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
    if (this.opts.isDisposed()) return

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
        if (this.opts.isDisposed()) return
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

    if (this.opts.isDisposed()) return
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

    if (this.opts.isDisposed()) return
    this.live = await (this.opts.detectLive ?? detectLiveSessions)()
    if (this.opts.isDisposed()) return
    // Inside the refresh itself, rather than at each of its callers: the Refresh button, the file
    // watcher and the periodic rescan all arrive here, and a setting called "import everything
    // automatically" that only held for some of those routes would be the worst kind of half-true.
    if (this.autoImportAll) {
      await this.importAllDiscovered()
    }
    // Deliberately not awaited: see updateSearchIndex.
    void this.opts.updateSearchIndex()
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

  async checkConflict(sessionId: SessionId): Promise<ResumeConflict | null> {
    const pid = this.live.get(sessionId)
    return pid === undefined ? null : { sessionId, pid }
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
}
