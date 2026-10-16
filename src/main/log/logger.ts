import { appendFileSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ignoreErrors } from '@shared/ignoreErrors'
import { redact, redactString } from '@shared/redact'
import type { LogLevel, LogScope, LogStatusPayload } from '@shared/domain/log'
import { filesToPrune, shouldRotate, type LogFile } from './rotation'

export type { LogLevel } from '@shared/domain/log'

/**
 * The diagnostic log. Rationale and rules: `src/main/log/CLAUDE.md`.
 *
 * - **Off unless asked for.** Disabled means no directory, no file, and `log()` returns immediately.
 * - **Redacted on the way in.** Every field goes through `redact` (`shared/redact.ts`) before it is
 *   serialised. Message text, prompts and transcript content are never passed at all.
 * - **Synchronous appends.** The volume is low (events, never PTY output), and a buffered log
 *   loses the last line before a crash.
 * - **Never breaks the app.** Every entry point swallows its own errors.
 */

export interface LoggerOptions {
  enabled: boolean
  /** Directory the log files live in. Created only when logging is switched on. */
  dir: string
  retentionDays: number
  maxSizeMb: number
  /** The running user's home, rewritten to `~` in every field. */
  home?: string
}

/** An alias: `LogStatusPayload` is the canonical (shared) name. */
export type LogStatus = LogStatusPayload

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
    // Re-read the active file's size: another instance's rotation or a folder emptied by hand
    // changes it from outside this process.
    this.ready = false
    this.activeBytes = 0
    if (!opts.enabled) return
    ignoreErrors(() => {
      this.prepare()
      this.prune()
    }, 'a directory that cannot be made means no logging')
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
      ignoreErrors(() => { rmSync(join(this.opts.dir, name), { force: true }) }, 'it can go next time')
    }
  }

  /** Rolls the active file aside under a sortable, timestamped name. */
  private rotate(): void {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    // A failed rename leaves the active file growing; the size budget still removes older files.
    ignoreErrors(() => {
      renameSync(join(this.opts.dir, ACTIVE), join(this.opts.dir, `${PREFIX}-${stamp}${SUFFIX}`))
      this.activeBytes = 0
      this.prune()
    }, 'a failed rotation leaves the active file in place')
  }

  log(level: LogLevel, scope: LogScope | `renderer:${LogScope}`, message: string, fields: LogFields = {}): void {
    if (!this.enabled) return
    ignoreErrors(() => {
      this.prepare()
      // `fields` is spread before the fixed keys so a field named "msg" or "scope" (renderer
      // messages carry caller-chosen ones) cannot override the redacted values.
      const entry = {
        ...(redact(fields, { home: this.opts.home }) as LogFields),
        ts: new Date().toISOString(),
        level,
        scope: redactString(scope, { home: this.opts.home }),
        msg: redactString(message, { home: this.opts.home }),
      }
      const line = `${JSON.stringify(entry)}\n`
      const bytes = Buffer.byteLength(line)
      if (shouldRotate(this.activeBytes, bytes, this.budgetBytes)) this.rotate()
      appendFileSync(join(this.opts.dir, ACTIVE), line)
      this.activeBytes += bytes
    }, 'logging must never break the app')
  }

  debug(scope: LogScope, message: string, fields?: LogFields): void { this.log('debug', scope, message, fields) }
  info(scope: LogScope, message: string, fields?: LogFields): void { this.log('info', scope, message, fields) }
  warn(scope: LogScope, message: string, fields?: LogFields): void { this.log('warn', scope, message, fields) }
  error(scope: LogScope, message: string, fields?: LogFields): void { this.log('error', scope, message, fields) }

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

  /** Deletes every log file. Offered in Settings. */
  clear(): void {
    for (const file of this.listFiles()) {
      ignoreErrors(() => { rmSync(join(this.opts.dir, file.name), { force: true }) }, 'it can go next time')
    }
    this.activeBytes = 0
  }
}

/** The app's logger: a module singleton, inert until startup calls `configure`, so a test that never does writes no files. */
export const log = new Logger()
