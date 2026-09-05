import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

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

export async function detectLiveSessions(): Promise<Map<string, number>> {
  try {
    const { stdout } = await run('ps', ['-eo', 'pid=,args='], {
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    })
    return parseLiveSessions(stdout)
  } catch {
    // ps unavailable or restricted — degrade to "nothing is live".
    return new Map()
  }
}
