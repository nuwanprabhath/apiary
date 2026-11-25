import { errorMessage } from '@shared/errors'
import { createExec } from '../exec/run'

const COMMAND_TIMEOUT_MS = 60 * 1000
/** A command's output is cut here before it joins the chat. */
const COMMAND_OUTPUT_MAX = 20_000
/** A failed command's first error line is cut here. */
const COMMAND_ERROR_MAX = 300

/** Runs a quick action's argv (execFile, no shell) in `cwd` with `env` added; resolves with stdout. */
export type RunCommand = (argv: string[], cwd: string, env: Record<string, string>) => Promise<string>

export const runCommand: RunCommand = (argv, cwd, env) =>
  createExec({ timeoutMs: COMMAND_TIMEOUT_MS, scope: 'residents', env })(argv[0] ?? '', argv.slice(1), cwd)

/**
 * Runs a command quick action and returns what the chat shows: its stdout, a "done, no output"
 * line, or "**label** failed: …" with the first line of the error. Never throws.
 */
export async function commandActionText(label: string, run: () => Promise<string>): Promise<string> {
  try {
    const out = (await run()).trim()
    if (out === '') return `**${label}**: done, no output.`
    return out.slice(0, COMMAND_OUTPUT_MAX)
  } catch (e) {
    const firstLine = errorMessage(e).split('\n')[0] ?? ''
    return `**${label}** failed: ${firstLine.slice(0, COMMAND_ERROR_MAX)}`
  }
}
