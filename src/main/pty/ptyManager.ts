import { existsSync } from 'node:fs'
import * as pty from 'node-pty'
import { loginShell } from './resumeCommand'

export interface SpawnOptions {
  id: string
  cwd: string
  /** Payload passed to `$SHELL -l -c`. */
  command: string
  cols?: number
  rows?: number
}

type DataHandler = (id: string, data: string) => void
type ExitHandler = (id: string, exitCode: number) => void

/**
 * Per-process cap, in `killAll()`, on how long we wait for a killed PTY's real exit before
 * giving up on it. Measured directly on this machine (macOS, node-pty spawning `/bin/bash`):
 * a normal login shell's `onExit` fires ~5-200ms after `kill()` (a plain `sleep 30` under a
 * default-handling shell exited ~205ms after the kill signal was sent). A shell that traps and
 * ignores SIGHUP/SIGTERM, by contrast, did not exit within 3000ms at all — i.e. some processes
 * will not die from this signal within any bounded wait, by design. 1500ms was chosen as
 * comfortably above the observed well-behaved case (roughly 7-10x headroom) while still keeping
 * `app.quit()` responsive; it was NOT derived from timing a real `claude --resume` child, which
 * was not measured here. A well-behaved shell or `claude` process should clear this bound with
 * room to spare; a process that ignores the signal will hit the timeout and be abandoned
 * regardless of what this constant is set to — see the comment on `killAll()`.
 */
const PTY_KILL_TIMEOUT_MS = 1500

export class PtyManager {
  private processes = new Map<string, pty.IPty>()
  private lastSize = new Map<string, { cols: number; rows: number }>()
  private cwds = new Map<string, string>()
  private dataHandlers: DataHandler[] = []
  private exitHandlers: ExitHandler[] = []

  onData(handler: DataHandler): void { this.dataHandlers.push(handler) }
  onExit(handler: ExitHandler): void { this.exitHandlers.push(handler) }
  has(id: string): boolean { return this.processes.has(id) }

  /**
   * The cwd a still-running pty was actually spawned with. Lets a caller (e.g. opening a shell
   * alongside a not-yet-resolved new session) key a second pty off an already-running one's real
   * directory without the renderer ever having to send a raw filesystem path across IPC.
   */
  getCwd(id: string): string | undefined { return this.cwds.get(id) }

  spawn(opts: SpawnOptions): void {
    if (!existsSync(opts.cwd)) {
      throw new Error(`Working directory does not exist: ${opts.cwd}`)
    }
    this.kill(opts.id)

    // A login shell is what puts nvm/homebrew installs of `claude` on PATH,
    // and it behaves the same on macOS and Ubuntu.
    const child = pty.spawn(loginShell(), ['-l', '-c', opts.command], {
      name: 'xterm-256color',
      cwd: opts.cwd,
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    })

    child.onData((data) => {
      for (const h of this.dataHandlers) h(opts.id, data)
    })
    child.onExit(({ exitCode }) => {
      this.processes.delete(opts.id)
      for (const h of this.exitHandlers) h(opts.id, exitCode)
    })

    this.processes.set(opts.id, child)
    this.lastSize.set(opts.id, { cols: opts.cols ?? 80, rows: opts.rows ?? 24 })
    this.cwds.set(opts.id, opts.cwd)
  }

  write(id: string, data: string): void {
    try {
      this.processes.get(id)?.write(data)
    } catch {
      // The process can exit between the renderer sending a keystroke and this call landing.
    }
  }

  /**
   * Resizes the pty to the requested size. If the requested size is unchanged from the size we
   * last applied, the OS's TIOCSWINSZ ioctl is a no-op — the kernel only raises SIGWINCH when
   * the new size actually differs from the pty's current size — so nothing tells a
   * readline-based shell to redraw its prompt. That matters when `TerminalView` mounts onto an
   * already-running pty at its existing size (a tab switch back, not a fresh spawn): the new
   * xterm instance starts with empty scrollback, and without a redraw the pane looks blank.
   *
   * Two things were tried and rejected before landing on the approach below (both verified
   * directly against a real interactive login shell sitting idle at its prompt, not just this
   * synthetic-signal test):
   *
   * - Delivering a bare SIGWINCH via `child.kill('SIGWINCH')` on a detected no-op: this does
   *   NOT redraw anything. Readline only redisplays the current line when its own TIOCGWINSZ
   *   query — made when it handles the signal — reports an actual dimension change, not merely
   *   on receiving the signal with the winsize unchanged.
   * - Two `resize()` calls back-to-back in the same synchronous turn (kick to one row off the
   *   target, then immediately back): this ALSO produced no redraw. Two same-type POSIX signals
   *   delivered before the child gets scheduled to handle the first one coalesce into a single
   *   delivery (non-realtime signals aren't queued), so by the time the shell's signal handler
   *   actually runs and queries the size, the two ioctls have already cancelled out and it sees
   *   no change at all.
   *
   * What works, and what's used here: kick to one row off the target, then defer the second
   * `resize()` back to the target by one microtask turn (`queueMicrotask`). That's enough of a
   * gap for the kernel to actually schedule and deliver the first SIGWINCH before the second
   * ioctl reverts the size, so both real, distinct kernel-level size changes register and the
   * shell redraws twice (settling on the correct, unchanged-looking content). It is not a full
   * event-loop turn, so nothing else running on the main process — another IPC message
   * included — can land between the two calls; this is what actually closes the race the old
   * renderer-side version had, where the two halves were separate fire-and-forget
   * `ipcRenderer.send` calls with no such guarantee. It only fires on a genuine no-op, so a
   * brand-new spawn (never a no-op — there is no `lastSize` entry yet) never pays for it.
   */
  resize(id: string, cols: number, rows: number): void {
    const child = this.processes.get(id)
    if (!child) return
    const clampedCols = Math.max(1, cols)
    const clampedRows = Math.max(1, rows)
    const last = this.lastSize.get(id)
    const isNoOp = last !== undefined && last.cols === clampedCols && last.rows === clampedRows
    try {
      if (isNoOp) {
        const kickedRows = clampedRows > 1 ? clampedRows - 1 : clampedRows + 1
        child.resize(clampedCols, kickedRows)
        queueMicrotask(() => {
          try {
            child.resize(clampedCols, clampedRows)
          } catch {
            // The process can exit between the two halves of the kick.
          }
        })
      } else {
        child.resize(clampedCols, clampedRows)
        this.lastSize.set(id, { cols: clampedCols, rows: clampedRows })
      }
    } catch {
      // The process can exit between the renderer measuring and this call.
    }
  }

  kill(id: string): void {
    const child = this.processes.get(id)
    if (!child) return
    this.processes.delete(id)
    this.lastSize.delete(id)
    this.cwds.delete(id)
    try { child.kill() } catch { /* already gone */ }
  }

  /**
   * Kills every live PTY and waits for each to actually exit (bounded by `timeoutMs` per
   * process) before resolving. Used on app quit: node-pty marshals a killed process's exit
   * event into JS from a background thread, and if that delivery is still in flight when
   * Electron's own teardown begins, it can throw with no JS context left to catch it — an
   * uncaught native exception that aborts the whole process.
   *
   * This *reduces* that race, it does not eliminate it. For any PTY whose `onExit` fires before
   * `timeoutMs`, the race is fully closed — we only resolve once the real exit has happened. But
   * if a child ignores the kill signal (or is wedged) and outlives the timeout, we give up
   * waiting on it and resolve anyway so `app.quit()` cannot hang forever. In that case the
   * abandoned child's `onExit` can still fire later on node-pty's background thread, after Node
   * teardown has begun — the exact race this function exists to prevent, just for that one
   * straggler. See the `PTY_KILL_TIMEOUT_MS` comment above for why 1500ms was chosen and what it
   * is (and isn't) based on.
   */
  async killAll(timeoutMs = PTY_KILL_TIMEOUT_MS): Promise<void> {
    const children = [...this.processes.entries()]
    await Promise.all(children.map(([id, child]) => new Promise<void>((resolve) => {
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
    })))
  }
}
