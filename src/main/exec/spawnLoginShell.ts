import {
  spawn as nodeSpawn,
  type ChildProcess, type ChildProcessByStdio, type ChildProcessWithoutNullStreams, type SpawnOptions,
} from 'node:child_process'
import type { Readable } from 'node:stream'
import { loginShellInvocation, type LoginShellCommand } from './loginShell'

/** `child_process.spawn`'s shape, injectable so tests can hand back a fake child. */
export type LoginShellSpawn = (file: string, args: string[], options: SpawnOptions) => ChildProcess

export interface LoginShellSpec {
  command: LoginShellCommand
  cwd: string
  /** Process-group leader, so `signal`/`stop` end everything it started (a wrapper script's
   *  children too), not just the shell. Off for a child that is a single `exec`'d process. */
  detached?: boolean
  /** The shell to run; default is `loginShell()` (`$SHELL`). */
  shell?: string
  /** Which event ends `exited`: `exit` (the process is gone) or `close` (and its stdio has drained,
   *  which a caller reading all of stdout needs). Default `exit`. */
  settleOn?: 'exit' | 'close'
}

interface LoginShellExit {
  code: number | null
  signal: NodeJS.Signals | null
  /** Set when the process could not be started (or signalled); `code` and `signal` are then null. */
  error?: Error
}

export interface LoginShellProcess<C extends ChildProcess> {
  child: C
  /**
   * Settles exactly once, and always: on the process ending, or on the child's `'error'` event
   * (a login shell that does not exist, a cwd that is gone). It never rejects and cannot be left
   * pending by a failed spawn, so a caller that awaits it on quit cannot hang (MAIN-19). Await it
   * rather than listening to the child's own events.
   */
  exited: Promise<LoginShellExit>
  /** Sends `sig` to the process group when it leads one (`detached`), else to the child alone. */
  signal(sig?: NodeJS.Signals): void
  /** SIGTERM, then SIGKILL after `graceMs` if it has not gone; resolves once `exited` has. */
  stop(graceMs?: number): Promise<void>
}

/** What `spawnLoginShell` returns for `stdin: 'pipe'` (the default) and `stdin: 'ignore'`, named so
 *  a holder of one need not import `node:child_process` types itself. */
export type PipedLoginShell = LoginShellProcess<ChildProcessWithoutNullStreams>
export type NoStdinLoginShell = LoginShellProcess<ChildProcessByStdio<null, Readable, Readable>>

const DEFAULT_GRACE_MS = 3000

/**
 * Starts a long-lived process through the user's login shell — the one way main does it, next to
 * `createExec` (`run.ts`) for a short-lived command. Owns what each hand-rolled spawn here had
 * missed at least once: the shell and argv (`loginShellInvocation`), the env (`childEnv`), the
 * process-group kill, and a mandatory `'error'` listener.
 *
 * `stdin: 'ignore'` for a process that must not wait on input (`claude -p`); `'pipe'` (the default)
 * for one spoken to over stdin (chat).
 */
export function spawnLoginShell(
  spec: LoginShellSpec & { stdin?: 'pipe' }, spawn?: LoginShellSpawn,
): PipedLoginShell
export function spawnLoginShell(
  spec: LoginShellSpec & { stdin: 'ignore' }, spawn?: LoginShellSpawn,
): NoStdinLoginShell
export function spawnLoginShell(
  spec: LoginShellSpec & { stdin?: 'pipe' | 'ignore' }, spawn: LoginShellSpawn = nodeSpawn,
): LoginShellProcess<ChildProcess> {
  const { file, args, env } = loginShellInvocation(spec.command, { shell: spec.shell })
  const detached = spec.detached === true
  const child = spawn(file, args, {
    cwd: spec.cwd,
    env,
    stdio: [spec.stdin ?? 'pipe', 'pipe', 'pipe'],
    ...(detached ? { detached: true } : {}),
  })

  let done = false
  const exited = new Promise<LoginShellExit>((resolve) => {
    const settle = (result: LoginShellExit): void => { if (!done) { done = true; resolve(result) } }
    // `on`, not `once`: a second error (a failed kill after the spawn error) must not throw either.
    child.on('error', (error: Error) => { settle({ code: null, signal: null, error }) })
    child.once(spec.settleOn ?? 'exit', (code: number | null, signal: NodeJS.Signals | null) => { settle({ code, signal }) })
  })

  const signal = (sig: NodeJS.Signals = 'SIGTERM'): void => {
    try {
      if (detached && child.pid !== undefined) { process.kill(-child.pid, sig); return }
    // eslint-disable-next-line apiary/no-silent-catch -- ESRCH/EPERM: the group is gone or was never ours; the child-only kill below is the fallback
    } catch { /* fall back to the child alone */ }
    child.kill(sig)
  }

  const stop = async (graceMs = DEFAULT_GRACE_MS): Promise<void> => {
    if (done) return
    signal('SIGTERM')
    const timer = setTimeout(() => { signal('SIGKILL') }, graceMs)
    try { await exited } finally { clearTimeout(timer) }
  }

  return { child, exited, signal, stop }
}
