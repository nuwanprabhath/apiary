/*
 * SessionCatalog - design note.
 *
 * What it owns: the `live` map (session id -> pid of an external claude process, from
 * `detectLive`), the refresh state machine, and the sidebar read model (tree, discovered, import*).
 *
 * `live` ownership. Written in exactly one place: `scanLive` (the end of `runRefresh`, or the
 * throttled follow-up), as a whole-map replacement after the store sync (never mutated in place, so a reader sees either the old or the
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
 *   Live detection (`ps`) is throttled, not per pass: a full pass always scans (startup, the Refresh
 *   button, a move all need the truth now), but a scoped pass, which the watcher fires about once a
 *   second while any session writes, scans at most once per `liveMinIntervalMs`. A scoped pass
 *   inside the window arms one trailing scan for the window's end, and if that changed who is
 *   live it calls `onLiveChanged` so the tree is re-sent: the dot is late by at most the window.
 *   `whenIdle()` awaits the current promise (including chained reruns) and swallows its failure;
 *   AppService.dispose() uses it so the store is not closed under a running pass.
 */
import { existsSync } from 'node:fs'
import { extractMeta } from '../scanner/sessionScanner'
import type { SessionSource } from '../sources/claudeProjects'
import type { WorktreeResolver } from '../git/worktreeResolver'
import type { SessionStore, StoredSession } from '../store/sessionStore'
import { buildTree } from '../tree/buildTree'
import { detectLiveSessions } from '../claude/live/liveSessionDetector'
import { log } from '../log/logger'
import { errorMessage } from '@shared/errors'
import { ignoreErrorsAsync } from '@shared/ignoreErrors'
import { memoize } from '../util/memoize'
import type { ProjectNode, ResumeConflict, SessionMeta, ProjectInfo } from '@shared/types'
import type { SessionId } from '@shared/domain/ids'

interface RefreshRequest {
  /** Every transcript is stat'd (unchanged ones skipped) and every known cwd re-resolved. */
  full: boolean
  /** A scoped pass re-reads only these transcripts and re-resolves their cwds. Ignored when `full`. */
  paths: Set<string>
}

/** At most one process scan per this long on scoped passes. Short enough that a session which
 *  just started shows its live dot within a couple of seconds, long enough that a busy session
 *  (a pass per second) stops costing a `ps` per pass. */
const LIVE_MIN_INTERVAL_MS = 3000

/** Folders resolved concurrently per pass: each is a few git spawns, so a cap avoids hundreds at once. */
const RESOLVE_CONCURRENCY = 8

export interface SessionCatalogOptions {
  store: SessionStore
  source: SessionSource
  worktrees: WorktreeResolver
  /** Defaults to the real process scan. */
  detectLive?: () => Promise<Map<string, number>>
  /** Scoped passes scan at most this often (default `LIVE_MIN_INTERVAL_MS`); full passes always scan. */
  liveMinIntervalMs?: number
  /** Called when a scan that ran outside a pass (the trailing one) changed who is live. */
  onLiveChanged?: () => void
  autoImportAll?: boolean
  /** True once shutdown has started; passes stop scheduling and writing. */
  isDisposed: () => boolean
  /** Fire-and-forget search index update at the end of a pass (see AppService.updateSearchIndex). */
  updateSearchIndex: () => Promise<void>
  /** Runs after every `refresh()` call settles (not once per pass): chats that moved onto a new
   *  session are adopted into the library once their file has been scanned. */
  afterRefresh?: () => void
}

export class SessionCatalog {
  private live = new Map<string, number>()
  /** When the last process scan started, and the one armed to run when the window ends. */
  private liveScannedAt = 0
  private liveTimer: NodeJS.Timeout | null = null
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
    const inFlight = this.refreshPromise
    // The rejection belongs to whoever called `refresh`; this only waits for the run to end.
    if (inFlight) await ignoreErrorsAsync(() => inFlight, 'refresh callers see the failure; this only waits')
  }

  /**
   * `opts` omitted (the Refresh button, the menu, the `refresh` IPC channel, `moveSession`) means
   * a full rescan. `{ paths }` is a scoped pass, which the filesystem watcher asks for: only
   * those transcripts are re-read, and only their cwds are re-resolved through git.
   */
  private normalizeRefreshRequest(opts?: { full?: boolean; paths?: string[] }): RefreshRequest {
    if (!opts || opts.full === true || !opts.paths || opts.paths.length === 0) {
      return { full: true, paths: new Set() }
    }
    return { full: false, paths: new Set(opts.paths) }
  }

  async refresh(opts?: { full?: boolean; paths?: string[] }): Promise<void> {
    await this.refreshJoined(opts)
    this.opts.afterRefresh?.()
  }

  private refreshJoined(opts?: { full?: boolean; paths?: string[] }): Promise<void> {
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
      // A rejection must not wedge future refreshes.
      this.pendingRefresh = null
      this.refreshPromise = null
      throw e
    }
    if (this.pendingRefresh && !this.opts.isDisposed()) {
      const next = this.pendingRefresh
      this.pendingRefresh = null
      // Chained onto this same promise so a caller that only joined sees a pass that ran after its trigger.
      this.refreshPromise = this.runRefreshLoop(next)
      return this.refreshPromise
    }
    this.refreshPromise = null
  }

  private async runRefresh(req: RefreshRequest): Promise<void> {
    const started = Date.now()
    // A scoped pass keeps the resolver's earlier answers; only a full pass sees a checkout or
    // worktree removal done outside Apiary.
    if (req.full) this.opts.worktrees.clearCache()
    this.opts.worktrees.resetSpawnCount()

    let metas: SessionMeta[]
    let filesSeen: number
    let filesParsed = 0
    if (req.full) {
      // Skip re-parsing (up to 128KB of) a file whose size and mtime match the store's record.
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
      // The watcher named the changed files, so each is re-read unconditionally, with no directory walk.
      metas = []
      filesSeen = req.paths.size
      for (const path of req.paths) {
        if (this.opts.isDisposed()) return
        if (!path.endsWith('.jsonl')) continue
        const meta = await ignoreErrorsAsync(() => extractMeta(path), 'deleted or unreadable: the row stays as it was')
        if (meta !== undefined) {
          metas.push(meta)
          filesParsed += 1
        }
      }
    }
    // A library of a few hundred folders measured ~35s per pass, and quitting waits for the pass
    // in flight, so every step checks for shutdown and stops: what it would have written is
    // rebuilt from the JSONL by the next launch's scan.
    if (this.opts.isDisposed()) return

    const byRawCwd = new Map<string, SessionMeta[]>()
    for (const m of metas) {
      if (!m.cwd) continue
      const list = byRawCwd.get(m.cwd) ?? []
      list.push(m)
      byRawCwd.set(m.cwd, list)
    }

    // A full pass re-resolves every known cwd: a folder's branch can change with no transcript touched.
    const cwdsToResolve = new Set(byRawCwd.keys())
    if (req.full) {
      for (const cwd of this.store.distinctCwds()) cwdsToResolve.add(cwd)
    }

    // Grouped by canonical path (`resolveProject` uses realpath), not the raw JSONL string, so
    // two routes to one directory (a symlink) land under one project row.
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
        const info = await this.opts.worktrees.resolveProject(rawCwd)
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
    this.store.syncAll(entries)

    log.info('refresh', 'pass', {
      full: req.full,
      files: filesSeen,
      parsed: filesParsed,
      folders: rawCwds.length,
      gitSpawns: this.opts.worktrees.spawnCount(),
      ms: Date.now() - started,
    })

    if (this.opts.isDisposed()) return
    if (req.full || this.liveWindowElapsed()) await this.scanLive()
    else this.armLiveScan()
    if (this.opts.isDisposed()) return
    // Here rather than at each caller, so every route into a refresh honours the setting.
    if (this.autoImportAll) {
      await this.importAllDiscovered()
    }
    // Deliberately not awaited: see updateSearchIndex.
    void this.opts.updateSearchIndex()
  }

  private liveWindowMs(): number { return this.opts.liveMinIntervalMs ?? LIVE_MIN_INTERVAL_MS }

  private liveWindowElapsed(): boolean {
    return Date.now() - this.liveScannedAt >= this.liveWindowMs()
  }

  /** The one place `live` is replaced (see the note at the top). */
  private async scanLive(): Promise<void> {
    this.liveScannedAt = Date.now()
    this.live = await (this.opts.detectLive ?? detectLiveSessions)()
  }

  /** Arms a single scan for when the throttle window ends; further passes in it add nothing. */
  private armLiveScan(): void {
    if (this.liveTimer !== null) return
    const wait = Math.max(0, this.liveScannedAt + this.liveWindowMs() - Date.now())
    this.liveTimer = setTimeout(() => {
      this.liveTimer = null
      if (this.opts.isDisposed()) return
      const before = this.live
      this.scanLive().then(() => {
        const changed = before.size !== this.live.size || [...this.live.keys()].some((id) => !before.has(id))
        if (changed && !this.opts.isDisposed()) this.opts.onLiveChanged?.()
      }).catch((e: unknown) => { log.warn('refresh', 'live scan failed', { error: errorMessage(e) }) })
    }, wait)
    this.liveTimer.unref()
  }

  /**
   * Re-resolves one folder's project row without a full rescan, after a git mutation (a checkout,
   * a new branch). Bypasses the resolver's cache: the mutation is why the cached answer is stale.
   */
  async refreshProject(cwd: string): Promise<void> {
    const info = await this.opts.worktrees.resolveProject(cwd, { forceResolve: true })
    this.store.syncProject(info)
  }

  /** `existsSync` is memoised per call (`buildTree` asks once per session, every window on every `treeChanged`); `buildTree` stays pure. */
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
   * Each path is canonicalized the way `refresh()` keys project rows, so the flag lands on a real row.
   *
   * Each path must already name a known project: `resolveProject` runs `git` in whatever cwd it
   * is given, and the IPC boundary cannot assume the renderer only echoes paths from `discovered()`.
   */
  async importSessions(sessionIds: string[], autoImportProjects: string[]): Promise<void> {
    for (const path of autoImportProjects) {
      if (this.store.getProject(path) === null) {
        throw new Error(`Unknown project: ${path}`)
      }
    }
    this.store.setImported(sessionIds, true)
    for (const path of autoImportProjects) {
      const info = await this.opts.worktrees.resolveProject(path)
      this.store.setAutoImport(info.path, true)
    }
  }

  async checkConflict(sessionId: SessionId): Promise<ResumeConflict | null> {
    const pid = this.live.get(sessionId)
    return pid === undefined ? null : { sessionId, pid }
  }

  /**
   * Whether `sessionId` can still be resumed: in the store, transcript file present (removing its
   * worktree deletes it) and cwd present. Never throws: restore drops a stale one.
   */
  sessionIsResumable(sessionId: string): boolean {
    const session = this.store.getSession(sessionId)
    if (session === undefined || session === null) return false
    if (!existsSync(session.filePath)) return false
    return session.cwd !== null && existsSync(session.cwd)
  }
}
