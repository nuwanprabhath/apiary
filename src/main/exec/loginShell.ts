import { childEnv } from '../pty/childEnv'

/** The user's shell, from `$SHELL`; `/bin/bash` when it is unset or blank. */
export function loginShell(env: NodeJS.ProcessEnv = process.env): string {
  return env.SHELL && env.SHELL.trim() !== '' ? env.SHELL : '/bin/bash'
}

/**
 * What the login shell runs. A string is a ready-made shell command (`exec claude --resume …`,
 * built and quoted by `pty/resumeCommand.ts`). `{ bin, args }` is a binary plus arguments handed
 * over as positional parameters (`exec "$0" "$@"`), so nothing in them — a prompt, a path — is ever
 * parsed by the shell.
 *
 * In the `{ bin }` form, `flags` is fixed options the app wrote and `positional` is text that may
 * come from a user (a prompt). The invocation puts `--` between them, so a value starting with "-"
 * is never read as an option; there is no way to pass user text without it.
 */
export type LoginShellCommand =
  | string
  | { bin: string; flags: readonly string[]; positional?: readonly string[] }

export interface LoginShellInvocation {
  file: string
  args: string[]
  env: Record<string, string>
}

function binArgs(command: { flags: readonly string[]; positional?: readonly string[] }): string[] {
  const positional = command.positional ?? []
  return positional.length === 0 ? [...command.flags] : [...command.flags, '--', ...positional]
}

/**
 * The one recipe for starting something through the user's login shell: `$SHELL -l -c <command>`
 * with the parent's environment minus another Claude session's markers (`childEnv`). A login shell
 * is what puts an nvm or Homebrew `claude` on PATH for an app started from the Dock, and it
 * behaves the same on macOS and Ubuntu.
 *
 * Shared by `spawnLoginShell` (a `child_process` child) and `pty/ptyManager.ts` (a node-pty
 * terminal), so the two cannot drift apart.
 */
export function loginShellInvocation(
  command: LoginShellCommand,
  opts: { shell?: string; parentEnv?: NodeJS.ProcessEnv; extraEnv?: Record<string, string> } = {},
): LoginShellInvocation {
  const parentEnv = opts.parentEnv ?? process.env
  const tail = typeof command === 'string' ? [command] : ['exec "$0" "$@"', command.bin, ...binArgs(command)]
  return {
    file: opts.shell ?? loginShell(parentEnv),
    args: ['-l', '-c', ...tail],
    env: childEnv(parentEnv, opts.extraEnv),
  }
}
