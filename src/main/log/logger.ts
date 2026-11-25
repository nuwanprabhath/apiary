import { createHash, randomBytes } from 'node:crypto'
import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
  /** Privacy mode: drops content-like fields, truncates harder and pseudonymises host names. */
  strict?: () => boolean
}

/** Field names that could carry what someone wrote; strict mode drops them. `msg` is fixed, never one. */
const CONTENT_KEY = /^(text|message|body|prompt|content|reply|query)$/i
const HOST_KEY = /^(host|hostname|remote)$/
const STRICT_MAX = 200
const SALT = '.salt'

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

  private saltCache: { dir: string; salt: Buffer } | null = null

  /** The per-installation salt for host pseudonyms, made with the folder; `clear` removes it. */
  private salt(): Buffer {
    if (this.saltCache?.dir === this.opts.dir) return this.saltCache.salt
    const path = join(this.opts.dir, SALT)
    let salt: Buffer
    try {
      salt = readFileSync(path)
    } catch {
      salt = randomBytes(32)
      writeFileSync(path, salt, { mode: 0o600 })
    }
    this.saltCache = { dir: this.opts.dir, salt }
    return salt
  }

  private strictFields(fields: LogFields): LogFields {
    const out: LogFields = {}
    for (const [key, value] of Object.entries(fields)) {
      if (CONTENT_KEY.test(key)) continue
      out[key] = HOST_KEY.test(key) && typeof value === 'string'
        ? `host-${createHash('sha256').update(this.salt()).update(value).digest('hex').slice(0, 8)}`
        : value
    }
    return out
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
      const strict = this.opts.strict?.() === true
      const options = { home: this.opts.home, ...(strict ? { max: STRICT_MAX } : {}) }
      const entry = {
        ...(redact(strict ? this.strictFields(fields) : fields, options) as LogFields),
        ts: new Date().toISOString(),
        level,
        scope: redactString(scope, options),
        msg: redactString(message, options),
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
    ignoreErrors(() => { rmSync(join(this.opts.dir, SALT), { force: true }) }, 'it can go next time')
    this.saltCache = null
    this.activeBytes = 0
  }
}

/** The app's logger: a module singleton, inert until startup calls `configure`, so a test that never does writes no files. */
export const log = new Logger()
