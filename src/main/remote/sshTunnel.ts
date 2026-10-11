import { spawnLoginShell } from '../exec/spawnLoginShell'
import type { ExecFn } from '../exec/run'

/** A running `ssh -N -L`: what the client service needs of it, so a test can stand in. */
export interface SshTunnel {
  /** Settles once, when ssh is gone (it never rejects). */
  exited: Promise<void>
  /** What ssh has written to stderr so far. */
  stderr(): string
  stop(): Promise<void>
}

export type StartSshTunnel = (flags: string[], host: string, cwd: string) => SshTunnel

/**
 * Starts ssh through the login shell, so it sees the user's `SSH_AUTH_SOCK` and PATH even when the
 * app was started from the Dock. The host is the positional, after `--`: it can never be an option.
 */
export const startSshTunnel: StartSshTunnel = (flags, host, cwd) => {
  const proc = spawnLoginShell({ command: { bin: 'ssh', flags, positional: [host] }, cwd, stdin: 'ignore', detached: true })
  let stderr = ''
  proc.child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < 8192) stderr += chunk.toString() })
  proc.child.stdout.resume()
  return {
    exited: proc.exited.then((exit) => { if (exit.error) stderr += `\n${exit.error.message}` }),
    stderr: () => stderr,
    stop: () => proc.stop(),
  }
}

/**
 * A short ssh call through the login shell, shaped like `createExec`'s `ExecFn`. The first step of a
 * connection (asking for the work machine's home) used `createExec`, which runs without the login
 * environment: from the Dock it could miss an agent the tunnel then found, and fail where the
 * tunnel would not. Both now see the same environment.
 *
 * `args` are ssh's: options, then `--`, then the host and the remote command. It resolves with
 * stdout; it rejects with ssh's stderr, `cause.killed` set when the timeout stopped it.
 */
export function sshExec(timeoutMs: number): ExecFn {
  return (file, args, cwd) => new Promise<string>((resolve, reject) => {
    const split = args.indexOf('--')
    const flags = split === -1 ? args : args.slice(0, split)
    const positional = split === -1 ? [] : args.slice(split + 1)
    const proc = spawnLoginShell({ command: { bin: file, flags, positional }, cwd, stdin: 'ignore', settleOn: 'close' })
    let out = ''
    let err = ''
    proc.child.stdout.on('data', (chunk: Buffer) => { if (out.length < 65_536) out += chunk.toString() })
    proc.child.stderr.on('data', (chunk: Buffer) => { if (err.length < 8192) err += chunk.toString() })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; void proc.stop() }, timeoutMs)
    void proc.exited.then((exit) => {
      clearTimeout(timer)
      if (!timedOut && exit.code === 0) { resolve(out); return }
      const message = err.trim() !== '' ? err.trim() : exit.error?.message ?? `${file} exited with ${String(exit.code)}`
      reject(new Error(message, { cause: { killed: timedOut } }))
    })
  })
}
