import { appendFileSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { redact } from '@shared/redact'
import { filesToPrune, shouldRotate, type LogFile } from './rotation'

/**
 * The diagnostic log.
 *
 * It exists because of a bug that could not be reproduced: "Open installer" failed on one user's
 * Ubuntu with an Electron IPC message, and every hypothesis about why was disproved in a
 * container because the trigger lived in their desktop session. Nothing in the app recorded what
 * it had actually tried, so there was nothing to read.
 *
 * Four things decide its shape:
 *
 * - **Off unless asked for.** Disabled is the default and disabled means *nothing*: no directory
 *   is created, no file is opened, `log()` returns immediately. A diagnostic feature that writes
 *   by default is a diagnostic feature that writes things nobody agreed to.
 * - **Structured, and redacted on the way in.** Every field goes through `redact` (see
 *   `shared/redact.ts`) before it is serialised, so redaction cannot be forgotten at a call site.
 *   Message text, prompts and transcript content are never passed at all.
 * - **Synchronous appends.** The volume is low by design — events, not streams, and never PTY
 *   output — and a log that is buffered when the process dies is missing the lines that matter
 *   most. The one thing worth having in a crash is the last line before it.
 * - **It must never be the thing that breaks the app.** Every entry point swallows its own
 *   errors: a full disk, a read-only directory or a vanished folder makes logging stop, not the
 *   feature the user was actually using.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LoggerOptions {
  enabled: boolean
  /** Directory the log files live in. Created only when logging is switched on. */
  dir: string
  retentionDays: number
  maxSizeMb: number
  /** The running user's home, rewritten to `~` in every field. */
  home?: string
}

export interface LogStatus {
  enabled: boolean
  dir: string
  files: number
  bytes: number
}

const ACTIVE = 'apiary.log'
const PREFIX = 'apiary'
const SUFFIX = '.log'

/** Fields a call site attaches to an entry. Values are redacted; keys are not, so keep them plain. */
export type LogFields = Record<string, unknown>

export class Logger {
  private opts: LoggerOptions = { enabled: false, dir: '', retentionDays: 7, maxSizeMb: 20 }
  /** Size of the active file as last known, so an append does not stat on every line. */
  private activeBytes = 0
  private ready = false

  configure(opts: LoggerOptions): void {
    this.opts = opts
    // Always re-read the world rather than trusting the size carried from before: `configure`
    // means something changed, and the active file's size is the one piece of state here that
    // something *outside* this process can have changed — a rotation by another instance, or a
    // folder the user emptied by hand.
    this.ready = false
    this.activeBytes = 0
    if (!opts.enabled) return
    try {
      this.prepare()
      this.prune()
    } catch {
      // See the note on never breaking the app: a directory that cannot be made means no logging.
    }
  }

  get enabled(): boolean { return this.opts.enabled && this.opts.dir !== '' }

  private get budgetBytes(): number {
    return Math.max(1, this.opts.maxSizeMb) * 1024 * 1024
  }

  private prepare(): void {
    if (this.ready) return
    mkdirSync(this.opts.dir, { recursive: true })
    this.activeBytes = this.sizeOf(ACTIVE)
    this.ready = true
  }

  private sizeOf(name: string): number {
    try { return statSync(join(this.opts.dir, name)).size } catch { return 0 }
  }

  private listFiles(): LogFile[] {
    try {
      return readdirSync(this.opts.dir)
        .filter((n) => n.startsWith(PREFIX) && n.endsWith(SUFFIX))
        .map((name) => {
          const s = statSync(join(this.opts.dir, name))
          return { name, bytes: s.size, modifiedMs: s.mtimeMs }
        })
    } catch {
      return []
    }
  }

  private prune(): void {
    const doomed = filesToPrune(this.listFiles(), {
      now: Date.now(),
      retentionDays: this.opts.retentionDays,
      budgetBytes: this.budgetBytes,
      activeName: ACTIVE,
    })
    for (const name of doomed) {
      try { rmSync(join(this.opts.dir, name), { force: true }) } catch { /* it can go next time */ }
    }
  }

  /** Rolls the active file aside under a sortable, timestamped name. */
  private rotate(): void {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    try {
      renameSync(join(this.opts.dir, ACTIVE), join(this.opts.dir, `${PREFIX}-${stamp}${SUFFIX}`))
      this.activeBytes = 0
      this.prune()
    } catch {
      // A rename that fails leaves the active file in place: it keeps growing, and the size
      // budget still removes older files. Worse than rotating, better than losing the log.
    }
  }

  log(level: LogLevel, scope: string, message: string, fields: LogFields = {}): void {
    if (!this.enabled) return
    try {
      this.prepare()
      const entry = {
        ts: new Date().toISOString(),
        level,
        scope,
        msg: message,
        ...(redact(fields, { home: this.opts.home }) as LogFields),
      }
      const line = `${JSON.stringify(entry)}\n`
      const bytes = Buffer.byteLength(line)
      if (shouldRotate(this.activeBytes, bytes, this.budgetBytes)) this.rotate()
      appendFileSync(join(this.opts.dir, ACTIVE), line)
      this.activeBytes += bytes
    } catch {
      // Deliberately silent. Reporting a logging failure through the UI would turn a diagnostic
      // aid into a source of its own errors, which is precisely backwards.
    }
  }

  debug(scope: string, message: string, fields?: LogFields): void { this.log('debug', scope, message, fields) }
  info(scope: string, message: string, fields?: LogFields): void { this.log('info', scope, message, fields) }
  warn(scope: string, message: string, fields?: LogFields): void { this.log('warn', scope, message, fields) }
  error(scope: string, message: string, fields?: LogFields): void { this.log('error', scope, message, fields) }

  /** What Settings shows: where the logs are, how many, and how much disk they take. */
  status(): LogStatus {
    const files = this.listFiles()
    return {
      enabled: this.enabled,
      dir: this.opts.dir,
      files: files.length,
      bytes: files.reduce((sum, f) => sum + f.bytes, 0),
    }
  }

  /** Deletes every log file. Offered in Settings, and the honest counterpart to switching it on. */
  clear(): void {
    for (const file of this.listFiles()) {
      try { rmSync(join(this.opts.dir, file.name), { force: true }) } catch { /* as above */ }
    }
    this.activeBytes = 0
  }
}

/**
 * The app's logger.
 *
 * A module singleton so that `ptyManager`, `branchOps` and the update backend can record what
 * they did without every one of them being handed a logger through three constructors. It is
 * inert until `configure` is called from startup, which means importing it costs nothing and a
 * unit test that never configures it writes no files.
 */
export const log = new Logger()
