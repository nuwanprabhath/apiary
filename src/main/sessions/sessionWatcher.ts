import { watch, type FSWatcher } from 'chokidar'

/** A `chokidar.watch`-shaped factory, injectable so tests never touch the real filesystem
 *  watcher. */
export type WatchFn = (
  dir: string,
  opts: { depth: number; ignoreInitial: boolean; ignored: (path: string, stats?: { isFile(): boolean }) => boolean; awaitWriteFinish: { stabilityThreshold: number; pollInterval: number } },
) => Pick<FSWatcher, 'on' | 'close'>

export interface SessionWatcherOptions {
  /** `~/.claude/projects`, or a fixture root in tests. */
  dir: string
  /** Called once per debounce window with every path that changed during it (MAIN-1: scoped,
   *  not a signal to rescan everything). */
  onChange: (paths: string[]) => void
  /** How long to wait after the last change before calling `onChange` — Claude writes to a
   *  transcript often, so this coalesces a burst into one call. */
  debounceMs?: number
  /** Defaults to the real `chokidar.watch`; overridden in tests. */
  watch?: WatchFn
}

/**
 * Watches `~/.claude/projects` for transcript changes and debounces them into scoped refresh
 * requests (MAIN-13 step 2). Pulled out of `ipc/index.ts`'s composition so the debounce/coalescing
 * behaviour — previously only reachable through a live chokidar instance under `ipcMain` — can be
 * driven directly in a unit test via the injectable `watch`.
 *
 * Built in the container (so construction opens nothing) and started by `start()` from `index.ts`,
 * which is what puts a file handle and a timer behind it.
 *
 * `depth: 1` and the `ignored` filter (MAIN-25) exist because the scanner only ever reads
 * `<projects>/<slug>/*.jsonl`: a slug directory is depth 1, and anything else changing under it
 * (depth 2, or a non-`.jsonl` file) is not worth a rescan.
 */
export class SessionWatcher {
  private watcher: Pick<FSWatcher, 'on' | 'close'> | null = null
  private timer: NodeJS.Timeout | null = null
  private pendingPaths = new Set<string>()
  private readonly debounceMs: number

  constructor(private readonly options: SessionWatcherOptions) {
    this.debounceMs = options.debounceMs ?? 1000
  }

  /** Starts watching. A second call does nothing. */
  start(): void {
    if (this.watcher !== null) return
    const watchFn = this.options.watch ?? ((dir, opts) => watch(dir, opts))
    this.watcher = watchFn(this.options.dir, {
      depth: 1,
      ignoreInitial: true,
      ignored: (path: string, stats?: { isFile(): boolean }) =>
        stats?.isFile() === true && !path.endsWith('.jsonl'),
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    })
    const onFsChange = (path: string): void => {
      this.pendingPaths.add(path)
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => {
        this.timer = null
        const paths = [...this.pendingPaths]
        this.pendingPaths = new Set()
        this.options.onChange(paths)
      }, this.debounceMs)
    }
    this.watcher.on('add', onFsChange).on('change', onFsChange).on('unlink', onFsChange)
  }

  dispose(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    void this.watcher?.close()
    this.watcher = null
  }
}
