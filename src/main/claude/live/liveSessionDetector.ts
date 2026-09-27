import { createExec, type ExecFn } from '../../exec/run'

/** MAIN-23: same wrapper `branchOps.ts`/`worktreeResolver.ts` use, at this module's own 5s
 *  timeout and 8MB buffer (a `ps -eo` listing on a busy machine is far larger than a git command's
 *  output). Injectable so `tests/unit/liveSessionDetector.test.ts` can pin the "ps failed, degrade
 *  to nothing live" contract without a real `ps`. `cwd` is unused by `ps`, so `process.cwd()` is
 *  passed through unconditionally — the same as before this migration, when `run()` was called
 *  with no `cwd` option at all. */
const defaultExec: ExecFn = createExec({ timeoutMs: 5000, maxBuffer: 8 * 1024 * 1024, scope: 'live-sessions' })

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const RESUME = new RegExp(`--resume[=\\s]+(${UUID})`)
/** The executable must actually be claude — not a shell that merely mentions it. */
const IS_CLAUDE = /(^|\/)claude(\s|$)/

/**
 * A session started without --resume cannot be attributed to an id from ps
 * alone, so it is reported as not live rather than guessed at.
 */
export function parseLiveSessions(psOutput: string): Map<string, number> {
  const live = new Map<string, number>()
  for (const line of psOutput.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('PID')) continue
    const match = /^(\d+)\s+(.*)$/.exec(trimmed)
    if (!match) continue
    const [, pidText, args] = match
    const executable = args.split(/\s+/)[0]
    if (!IS_CLAUDE.test(executable)) continue
    const resume = RESUME.exec(args)
    if (!resume) continue
    live.set(resume[1], Number(pidText))
  }
  return live
}

export interface DetectLiveSessionsOptions {
  /** Injected in tests. */
  exec?: ExecFn
}

export async function detectLiveSessions(options: DetectLiveSessionsOptions = {}): Promise<Map<string, number>> {
  const exec = options.exec ?? defaultExec
  try {
    const stdout = await exec('ps', ['-eo', 'pid=,args='], process.cwd())
    return parseLiveSessions(stdout)
  } catch {
    // ps unavailable or restricted — degrade to "nothing is live".
    return new Map()
  }
}
