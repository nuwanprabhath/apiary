import { existsSync } from 'node:fs'
import * as pty from 'node-pty'
import { loginShell } from './resumeCommand'
import { log } from '../log/logger'
import { ScreenBuffers, type ScreenSnapshot } from './screen'

export interface SpawnOptions {
  id: string
  cwd: string
  /** Payload passed to `$SHELL -l -c`. */
  command: string
  cols?: number
  rows?: number
  /**
   * Whether the child is a full-screen program that reads keys itself (Claude Code), as opposed to
   * a plain shell. Such a program is only safe to type into once it has actually started: see
   * `whenQuiet()`.
   */
  tui?: boolean
  /** Extra environment for this child, merged over the inherited environment. */
  env?: Record<string, string>
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

/**
 * Switching to the alternate screen buffer. A full-screen program emits this as it takes over the
 * terminal, which is also the point at which it has put the tty into raw mode — so it doubles as
 * the signal that input written now will reach the program as keystrokes rather than being
 * mangled by the line discipline first. See `whenQuiet()`.
 */
const ALT_SCREEN = '\x1b[?1049h'

/**
 * How much of each pty's recent output is kept so a *new* view of it can be brought up to date.
 *
 * Until this existed, scrollback lived only in whichever window's xterm happened to have been
 * attached since the process started. Opening the same session in a second window, or moving its
 * tab into a window of its own, produced a terminal that was simply blank until the program next
 * printed something — which, for a TUI waiting on input, can be never. Output is not something the
 * main process can regenerate, so it has to be remembered here.
 *
 * 256KB is roughly a full-screen TUI's worth of redraws and several screens of scrollback, which
 * is what a person needs to recognise where they are. It is a cap per pty, not a total: a handful
 * of sessions costs a couple of megabytes, against the alternative of a window that looks broken.
 */
const REPLAY_BYTES = 256 * 1024

export class PtyManager {
  private processes = new Map<string, pty.IPty>()
  private lastSize = new Map<string, { cols: number; rows: number }>()
  private cwds = new Map<string, string>()
  /** Per-pty: whether a full-screen child is expected, and whether it has actually started. */
  private expectTui = new Map<string, boolean>()
  private tuiStarted = new Map<string, boolean>()
  /** Per-pty output activity, so a caller can wait for the child to finish reacting to input. */
  private lastDataAt = new Map<string, number>()
  private outputCounts = new Map<string, number>()
  /** Recent output per pty, oldest-trimmed, for `replay()`. */
  private replayBuffers = new Map<string, string>()
  /** A headless terminal per pty, so `screen()` can report what is actually on screen rather than
   *  what was sent — see `screen.ts` for why those differ and why it matters. */
  private screens = new ScreenBuffers()
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
      env: { ...process.env, TERM: 'xterm-256color', ...opts.env } as Record<string, string>,
    })

    child.onData((data) => {
      this.remember(opts.id, data)
      this.screens.write(opts.id, data)
      this.lastDataAt.set(opts.id, Date.now())
      this.outputCounts.set(opts.id, (this.outputCounts.get(opts.id) ?? 0) + 1)
      if (data.includes(ALT_SCREEN)) this.tuiStarted.set(opts.id, true)
      for (const h of this.dataHandlers) h(opts.id, data)
    })
    child.onExit(({ exitCode }) => {
      log.info('pty', 'exited', { id: opts.id, exitCode })
      this.processes.delete(opts.id)
      for (const h of this.exitHandlers) h(opts.id, exitCode)
    })

    // Logged because "which pty, in which directory, with what extra environment" answered two
    // separate bugs: a second window killing the first's shell, and a prompt setting that never
    // reached the terminal it was meant for. The command is *not* logged — it can carry a session
    // id and, for a shell, whatever the user configured.
    log.info('pty', 'spawned', {
      id: opts.id,
      cwd: opts.cwd,
      tui: opts.tui ?? false,
      env: Object.keys(opts.env ?? {}),
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
    })
    this.processes.set(opts.id, child)
    this.lastSize.set(opts.id, { cols: opts.cols ?? 80, rows: opts.rows ?? 24 })
    // Before any output arrives, so the pty's very first screen is rendered at the right width.
    this.screens.resize(opts.id, opts.cols ?? 80, opts.rows ?? 24)
    this.cwds.set(opts.id, opts.cwd)
    this.expectTui.set(opts.id, opts.tui ?? false)
    this.tuiStarted.set(opts.id, false)
    this.lastDataAt.set(opts.id, Date.now())
    this.outputCounts.set(opts.id, 0)
    this.replayBuffers.set(opts.id, '')
  }

  /**
   * Appends to the replay buffer, trimming from the front once it is over the cap.
   *
   * Trimmed at a whole number of bytes rather than at an escape-sequence boundary, because there
   * is no way to find one cheaply and a terminal emulator discards a partial sequence at the start
   * of a stream without complaint. The first line of a replayed buffer may therefore be missing
   * its colour; every line after it is exact.
   */
  private remember(id: string, data: string): void {
    const next = (this.replayBuffers.get(id) ?? '') + data
    this.replayBuffers.set(id, next.length > REPLAY_BYTES ? next.slice(-REPLAY_BYTES) : next)
  }

  /**
   * What this pty has printed recently, for a view that is only now attaching to it.
   *
   * Empty for a pty that does not exist, which is the same answer as a pty that has printed
   * nothing — neither is an error, and a caller that has to tell them apart has `has()`.
   */
  replay(id: string): string {
    return this.replayBuffers.get(id) ?? ''
  }

  /**
   * This pty's screen, history included, as something a view can paint — see
   * `ScreenBuffers.snapshot` for why a view is given this rather than `replay()`. Null for a pty
   * that has printed nothing (or does not exist); the view then simply starts empty.
   */
  snapshot(id: string): Promise<ScreenSnapshot | null> {
    return this.screens.snapshot(id)
  }

  /**
   * What is on this pty's screen right now, as plain text — the input `classifyActivity` needs.
   *
   * Not the same thing as `replay()`, and the difference is the point: `replay()` is the byte
   * stream, which a view replays through its own emulator to rebuild the picture. This is that
   * picture, rendered here, for code that needs to *read* the terminal rather than show it.
   */
  screen(id: string): string {
    return this.screens.read(id)
  }

  /**
   * How many chunks of output this pty has produced. Only useful as a before/after comparison:
   * pass it to `whenQuiet` as `after` to wait for the child to react to something you wrote,
   * rather than mistaking the quiet that preceded your write for the quiet that follows it.
   */
  outputCount(id: string): number {
    return this.outputCounts.get(id) ?? 0
  }

  /**
   * When this pty last produced output, for `classifyActivity` (`shared/activity.ts`) to tell a
   * session that just went quiet from one that has been sitting at a prompt for a while. 0 for a
   * pty that has never existed, which reads the same as "not recently" to that classifier.
   */
  lastOutputAt(id: string): number {
    return this.lastDataAt.get(id) ?? 0
  }

  /**
   * Resolves once the pty looks ready to be written to.
   *
   * Writing to a pty is not the same as a program receiving what you wrote. Until a full-screen
   * program starts and puts the tty into raw mode, the terminal's line discipline is still in
   * canonical mode, where it buffers input by line and — the part that actually bit us —
   * translates carriage return to newline (ICRNL). A prompt delivered in that window arrives after
   * the program starts, but as text it never sees as a paste and with its submitting return turned
   * into a plain newline: it lands in the input box and just sits there.
   *
   * So for a `tui` pty this waits for the child to take the screen, and in every case waits for its
   * output to go quiet, meaning it has finished drawing and is listening. `capMs` bounds both: a
   * child that never gets there is written to anyway, which is no worse than not waiting at all.
   */
  whenQuiet(
    id: string,
    { quietMs, capMs, after }: { quietMs: number; capMs: number; after?: number },
  ): Promise<void> {
    return new Promise((resolve) => {
      const deadline = Date.now() + capMs
      const needsTui = this.expectTui.get(id) === true
      const tick = (): void => {
        if (!this.processes.has(id)) return resolve()
        const started = !needsTui || this.tuiStarted.get(id) === true
        const reacted = after === undefined || this.outputCount(id) > after
        const quietFor = Date.now() - (this.lastDataAt.get(id) ?? 0)
        if (started && reacted && quietFor >= quietMs) return resolve()
        if (Date.now() >= deadline) return resolve()
        setTimeout(tick, 25)
      }
      tick()
    })
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
        this.screens.resize(id, clampedCols, clampedRows)
      }
    } catch {
      // The process can exit between the renderer measuring and this call.
    }
  }

  kill(id: string): void {
    const child = this.processes.get(id)
    if (!child) return
    log.info('pty', 'killing', { id })
    this.processes.delete(id)
    this.lastSize.delete(id)
    this.cwds.delete(id)
    // Nothing will ever attach to a dead pty, so its scrollback is only a leak from here on.
    this.replayBuffers.delete(id)
    this.screens.dispose(id)
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
