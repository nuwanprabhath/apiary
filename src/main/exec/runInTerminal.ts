import { spawnSync } from 'node:child_process'

/**
 * Runs `file` attached to this process's terminal (stdin, stdout and stderr inherited) and waits for
 * it, blocking: for the command-line modes, where the person at the terminal sees the output and
 * answers a prompt (sudo's password) themselves. Returns the exit code; a signal or a failed start is 1.
 * Never for anything a window waits on: it stops the main process until the program ends.
 */
export function runInTerminal(file: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env): number {
  const result = spawnSync(file, [...args], { stdio: 'inherit', env })
  if (result.error !== undefined) {
    process.stderr.write(`Could not run ${file}: ${result.error.message}\n`)
    return 1
  }
  return result.status ?? 1
}
