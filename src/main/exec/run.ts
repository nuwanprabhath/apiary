import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { log } from '../log/logger'

const run = promisify(execFile)

/** The `(file, args, cwd) => stdout` shape already used as an injectable seam in
 *  `plugins/gitlabMr.ts`, `git/mrStatusCache.ts` and `vscode/detectVsCode.ts` (MAIN-23) — kept as
 *  the one signature rather than introducing a second, so those call sites (and their tests, which
 *  already pass fakes of this shape) do not have to change. */
export type ExecFn = (file: string, args: string[], cwd: string) => Promise<string>

export interface CreateExecOptions {
  timeoutMs?: number
  maxBuffer?: number
  /** A tag for the slow/failed-spawn log line — which caller this is, since `file`+`args` alone
   *  can be long. */
  scope?: string
}

/** How long a spawn may run before it is logged as slow, even when it eventually succeeds. */
const SLOW_SPAWN_MS = 2000

/**
 * Builds an `ExecFn` with one timeout/buffer policy and consistent logging (MAIN-23) — before
 * this, `worktreeResolver.ts`, `branchOps.ts`, `liveSessionDetector.ts`, `mrStatusCache.ts` and
 * `gitlabMr.ts` each called `promisify(execFile)` directly, with a different timeout and buffer
 * size and no record of a slow or failed spawn anywhere. Errors are normalised the way
 * `branchOps.git()` already did it: stderr first, then stdout, then the raw message, since a
 * conflicting operation's useful diagnostic often lands on stdout while stderr carries only
 * progress noise.
 *
 * `execFile` only, never a shell string (CLAUDE.md's security rule) — this wraps `execFile`
 * itself, so nothing built on it can regress that.
 */
export function createExec(options: CreateExecOptions = {}): ExecFn {
  const { timeoutMs = 8000, maxBuffer = 1024 * 1024, scope = 'exec' } = options
  return async (file, args, cwd) => {
    const startedAt = Date.now()
    try {
      const { stdout } = await run(file, args, { cwd, timeout: timeoutMs, maxBuffer })
      const durationMs = Date.now() - startedAt
      if (durationMs > SLOW_SPAWN_MS) {
        log.debug(scope, 'slow spawn', { file, args: args.join(' '), durationMs })
      }
      return stdout
    } catch (e) {
      const durationMs = Date.now() - startedAt
      const err = e as { stdout?: string; stderr?: string; message: string }
      const text = [err.stderr, err.stdout].filter(Boolean).join('\n').trim()
      log.debug(scope, 'spawn failed', { file, args: args.join(' '), durationMs, error: text !== '' ? text : err.message })
      throw new Error(text !== '' ? text : err.message, { cause: e })
    }
  }
}
