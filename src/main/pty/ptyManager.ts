import { existsSync } from 'node:fs'
import * as pty from 'node-pty'
import { ignoreErrors } from '@shared/ignoreErrors'
import { loginShellInvocation } from '../exec/loginShell'
import { log } from '../log/logger'
import type { AccountId } from '@shared/domain/ids'
import { ScreenBuffers, type ScreenSnapshot } from './screen'
import { strippedMarkers } from './childEnv'

export interface SpawnOptions {
  id: string
  cwd: string
  /** Payload passed to `$SHELL -l -c`. */
  command: string
  cols?: number
  rows?: number
  /** A full-screen program that reads keys itself (Claude Code), not a plain shell: see `whenQuiet()`. */
  tui?: boolean
  /** Extra environment for this child, merged over the inherited environment. */
  env?: Record<string, string>
  /** The Claude account a `claude` pty runs under; the tracker reads that account's `sessions` folder. */
  account?: AccountId
}

type DataHandler = (id: string, data: string) => void
type ExitHandler = (id: string, exitCode: number) => void

/**
 * Per-process cap, in `killAll()`, on how long we wait for a killed PTY's real exit. Measured on
 * macOS with node-pty spawning `/bin/bash`: a normal login shell's `onExit` fires ~5-200ms after
 * `kill()`; a shell that traps SIGHUP/SIGTERM did not exit within 3000ms at all. 1500ms is
 * 7-10x the well-behaved case while keeping `app.quit()` responsive. Not measured against a real
 * `claude --resume` child.
 */
const PTY_KILL_TIMEOUT_MS = 1500

/** Switch to the alternate screen: a full-screen program emits it once the tty is in raw mode, so input written now arrives as keystrokes. */
const ALT_SCREEN = '\x1b[?1049h'

/**
 * Everything the manager knows about one pty id, replaced or dropped as a unit.
 *
 * `child` is the occupant's identity: every callback compares its own IPty with `entry.child`
 * before acting. It is null once the process exited on its own; the entry then stays only for
 * `cwd` (`resolveShellCwd` reads it afterwards), until `kill()` or a respawn removes it.
 */
interface PtyEntry {
  child: pty.IPty | null
  cwd: string
  size: { cols: number; rows: number }
  expectTui: boolean
  tuiStarted: boolean
  lastDataAt: number
  outputCount: number
  /** The account the process was started under; null for a plain shell. */
  accountId: AccountId | null
}

export class PtyManager {
  /** The one place per-pty state lives: never add a second map keyed by pty id. */
  private entries = new Map<string, PtyEntry>()
  /** A headless terminal per pty: what is on screen differs from what was sent (see `screen.ts`). */
  private screens = new ScreenBuffers()
  private dataHandlers: DataHandler[] = []
  private exitHandlers: ExitHandler[] = []

  onData(handler: DataHandler): void { this.dataHandlers.push(handler) }
  onExit(handler: ExitHandler): void { this.exitHandlers.push(handler) }
  has(id: string): boolean { return this.liveChild(id) !== undefined }
  private liveChild(id: string): pty.IPty | undefined { return this.entries.get(id)?.child ?? undefined }

  /** The cwd a pty was spawned with, so a second pty can be keyed off it without the renderer sending a path. */
  getCwd(id: string): string | undefined { return this.entries.get(id)?.cwd }

  /**
   * The process id behind each live TUI pty. Sessions run as `$SHELL -l -c 'exec claude …'` and
   * `exec` keeps the pid, so this is the key of `~/.claude/sessions/<pid>.json`
   * (see `claudeSessionTracker.ts`).
   */
  tuiProcesses(): Map<string, { pid: number; accountId: AccountId | null }> {
    const out = new Map<string, { pid: number; accountId: AccountId | null }>()
    for (const [id, entry] of this.entries) {
      if (entry.child !== null && entry.expectTui) out.set(id, { pid: entry.child.pid, accountId: entry.accountId })
    }
    return out
  }

  accountOf(id: string): AccountId | null {
    const entry = this.entries.get(id)
    return entry !== undefined && entry.child !== null ? entry.accountId : null
  }

  /** The size a live pty has now, so a respawn on the same id opens at the width the view is at. */
  sizeOf(id: string): { cols: number; rows: number } | undefined {
    return this.entries.get(id)?.size
  }

  spawn(opts: SpawnOptions): void {
    if (!existsSync(opts.cwd)) {
      throw new Error(`Working directory does not exist: ${opts.cwd}`)
    }
    this.kill(opts.id)

    const shell = loginShellInvocation(opts.command, { extraEnv: opts.env })
    const child = pty.spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cwd: opts.cwd,
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      env: shell.env,
    })

    const entry: PtyEntry = {
      child,
      cwd: opts.cwd,
      size: { cols: opts.cols ?? 80, rows: opts.rows ?? 24 },
      expectTui: opts.tui ?? false,
      tuiStarted: false,
      lastDataAt: Date.now(),
      outputCount: 0,
      accountId: opts.account ?? null,
    }
    // Registered before the first byte is rendered, so the first screen is at the right width.
    this.entries.set(opts.id, entry)
    this.screens.resize(opts.id, entry.size.cols, entry.size.rows)

    child.onData((data) => {
      if (this.entries.get(opts.id)?.child !== child) return
      this.screens.write(opts.id, data)
      entry.lastDataAt = Date.now()
      entry.outputCount += 1
      if (data.includes(ALT_SCREEN)) entry.tuiStarted = true
      for (const h of this.dataHandlers) h(opts.id, data)
    })
    child.onExit(({ exitCode }) => {
      log.info('pty', 'exited', { id: opts.id, exitCode })
      const current = this.entries.get(opts.id)
      // A killed child's exit can arrive after a respawn took the entry.
      if (current !== undefined && current.child !== child) return
      if (current !== undefined) {
        // Exited on its own: release the headless `Terminal` (up to 1,000 lines of scrollback). `cwd` is kept.
        current.child = null
        this.screens.dispose(opts.id)
      }
      for (const h of this.exitHandlers) h(opts.id, exitCode)
    })

    // The command is not logged: it can carry a session id and whatever the user configured.
    log.info('pty', 'spawned', {
      id: opts.id,
      cwd: opts.cwd,
      tui: opts.tui ?? false,
      env: Object.keys(opts.env ?? {}),
      // Non-empty only when Apiary was started from inside a Claude Code session (see childEnv.ts).
      stripped: strippedMarkers(process.env),
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
    })
  }

  /** The screen, history included, for a late-attaching view (see `ScreenBuffers.snapshot`). Null if nothing was printed or the pty does not exist. */
  snapshot(id: string): Promise<ScreenSnapshot | null> {
    return this.screens.snapshot(id)
  }

  /** What is on the screen right now as plain text, rendered from the headless terminal: the input `classifyActivity` needs. */
  screen(id: string): string {
    return this.screens.read(id)
  }

  /** Chunks of output so far; pass it to `whenQuiet` as `after` so the quiet before your write is not mistaken for the quiet after. */
  outputCount(id: string): number {
    const entry = this.entries.get(id)
    return entry?.child ? entry.outputCount : 0
  }

  /** When this pty last produced output, for `classifyActivity`; 0 for an id that never existed. */
  lastOutputAt(id: string): number {
    const entry = this.entries.get(id)
    return entry?.child ? entry.lastDataAt : 0
  }

  /**
   * Resolves once the pty looks ready to be written to.
   *
   * Until a full-screen program puts the tty into raw mode, the line discipline is in canonical
   * mode and translates carriage return to newline (ICRNL): a prompt written then lands in the
   * input box and never submits.
   *
   * A `tui` pty waits for the child to take the screen; every pty waits for its output to go
   * quiet. `capMs` bounds both: a child that never gets there is written to anyway.
   */
  whenQuiet(
    id: string,
    { quietMs, capMs, after }: { quietMs: number; capMs: number; after?: number },
  ): Promise<void> {
    return new Promise((resolve) => {
      const deadline = Date.now() + capMs
      const needsTui = this.entries.get(id)?.expectTui === true
      const tick = (): void => {
        const entry = this.entries.get(id)
        if (!entry?.child) return resolve()
        const started = !needsTui || entry.tuiStarted
        const reacted = after === undefined || entry.outputCount > after
        const quietFor = Date.now() - entry.lastDataAt
        if (started && reacted && quietFor >= quietMs) return resolve()
        if (Date.now() >= deadline) return resolve()
        setTimeout(tick, 25)
      }
      tick()
    })
  }

  write(id: string, data: string): void {
    ignoreErrors(() => this.entries.get(id)?.child?.write(data), 'the pty can exit before the keystroke lands')
  }

  /**
   * An unchanged size raises no SIGWINCH, so a readline shell does not redraw; a `TerminalView`
   * mounting onto a running pty at its existing size would look blank.
   *
   * Measured against a real idle login shell, two approaches fail:
   * - A bare `child.kill('SIGWINCH')`: readline redisplays only when its TIOCGWINSZ query, made
   *   in the handler, reports an actual change.
   * - Two `resize()` calls in the same synchronous turn (one row off, then back): POSIX signals of
   *   one type coalesce before the child runs its handler, so the shell sees no change.
   *
   * What works: kick to one row off the target, then resize back to the target one microtask
   * later. That gap lets the kernel deliver the first SIGWINCH, so the shell redraws. A microtask
   * is not an event-loop turn, so no other IPC message can land between the two calls. Only a
   * genuine no-op pays for it.
   */
  resize(id: string, cols: number, rows: number): void {
    const entry = this.entries.get(id)
    const child = entry?.child
    if (entry === undefined || !child) return
    // A bad renderer message must not size the headless xterm in this process without bound.
    const clampedCols = Number.isFinite(cols) ? Math.min(1000, Math.max(1, Math.trunc(cols))) : 80
    const clampedRows = Number.isFinite(rows) ? Math.min(500, Math.max(1, Math.trunc(rows))) : 24
    const last = entry.size
    const isNoOp = last.cols === clampedCols && last.rows === clampedRows
    ignoreErrors(() => {
      if (isNoOp) {
        const kickedRows = clampedRows > 1 ? clampedRows - 1 : clampedRows + 1
        child.resize(clampedCols, kickedRows)
        queueMicrotask(() => {
          ignoreErrors(() => child.resize(clampedCols, clampedRows), 'the process can exit between the two halves of the kick')
        })
      } else {
        child.resize(clampedCols, clampedRows)
        entry.size = { cols: clampedCols, rows: clampedRows }
        this.screens.resize(id, clampedCols, clampedRows)
      }
    }, 'the pty can exit before the resize lands')
  }

  /**
   * Continues a program that suspended itself (SIGCONT to the pty's process group).
   *
   * Claude Code handles Ctrl+Z itself: it prints "Claude Code has been suspended. Run `fg`…" and
   * waits for SIGCONT. It runs as `exec claude` with no shell, so there is no `fg`. Measured on
   * Claude Code 2.1.284: the process is not stopped (`ps` shows `S`, not `T`), and a SIGCONT to
   * its group brings it back with the draft intact.
   *
   * The group, not just the pid: the process is the session leader, so its pid is the group id
   * and anything it started (a tool call's shell) is continued too.
   */
  resume(id: string): void {
    const child = this.entries.get(id)?.child
    if (!child) return
    log.info('pty', 'resuming', { id })
    try {
      process.kill(-child.pid, 'SIGCONT')
    } catch {
      ignoreErrors(() => process.kill(child.pid, 'SIGCONT'), 'already gone')
    }
  }

  kill(id: string): void {
    const child = this.entries.get(id)?.child
    if (!child) return
    log.info('pty', 'killing', { id })
    this.entries.delete(id)
    this.screens.dispose(id)
    ignoreErrors(() => child.kill(), 'already gone')
  }

  /**
   * Kills every live PTY and waits for each real exit (bounded by `timeoutMs` per process). On
   * quit: node-pty delivers a killed process's exit from a background thread, and if that is in
   * flight when Electron's teardown begins it throws with no JS context and aborts the process.
   *
   * This reduces the race, it does not eliminate it: a child that ignores the kill is abandoned
   * after the timeout so `app.quit()` cannot hang, and its late `onExit` can still hit it.
   */
  async killAll(timeoutMs = PTY_KILL_TIMEOUT_MS): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.killAndWait(id, timeoutMs)))
  }

  /** `kill(id)`, resolving once the process has really exited, or after `timeoutMs`. */
  killAndWait(id: string, timeoutMs = PTY_KILL_TIMEOUT_MS): Promise<void> {
    const child = this.entries.get(id)?.child
    if (!child) return Promise.resolve()
    return new Promise<void>((resolve) => {
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      const timer = setTimeout(done, timeoutMs)
      child.onExit(() => {
        clearTimeout(timer)
        done()
      })
      this.kill(id)
    })
  }
}
