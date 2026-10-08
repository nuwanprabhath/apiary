import type { LogScope } from '@shared/domain/log'
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { log } from '../log/logger'

/** `child_process.spawn`'s shape, injectable so a test can hand back a fake child. */
export type LaunchSpawn = (command: string, args: string[], options: Record<string, unknown>) => ChildProcess

/**
 * Starts a program that must outlive Apiary and that we never talk to (VS Code opening a folder):
 * detached, no stdio, no shell, unref'd — the third sanctioned way to start a process, beside
 * `createExec` (short-lived, wants the output) and `spawnLoginShell` (long-lived, supervised).
 *
 * `shell: false` and an argument array (never a template string) is the point: an argument such as
 * a folder path is not sanitized against shell metacharacters upstream, and must not need to be.
 *
 * `spawn` returns before the child exists, so a missing or unexecutable binary surfaces
 * asynchronously as an `'error'` event, not a throw. With no listener Node re-throws it as an
 * uncaught exception in main (MAIN-19), so one is always attached and logged under `scope`. A
 * synchronous throw from `spawn` itself (bad arguments) reaches the caller.
 */
export function launchDetached(command: string, args: string[], scope: LogScope, spawn: LaunchSpawn = nodeSpawn): void {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false })
  child.on?.('error', (error: Error) => {
    log.warn(scope, 'launch failed', { command, error: error.message })
  })
  child.unref?.()
}
