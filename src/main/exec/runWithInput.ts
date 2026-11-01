import type { LogScope } from '@shared/domain/log'
import { spawn as nodeSpawn } from 'node:child_process'
import { log } from '../log/logger'
import type { LaunchSpawn } from './launchDetached'

export interface InputRunResult {
  /** null when the process was killed (a timeout) rather than exiting. */
  code: number | null
  stdout: string
  stderr: string
}

export interface RunWithInputOptions {
  /** Written to stdin, then stdin is closed. A secret (sudo's password) goes here and nowhere else. */
  input: string
  timeoutMs: number
  /** Added to (and overriding) Apiary's own environment. */
  env?: Record<string, string>
  scope: LogScope
}

/** The most of each stream kept: an apt run can print a lot, and only the end of it is read. */
const MAX_CAPTURE = 256 * 1024

/**
 * Runs a short-lived command that reads secret input on stdin (`sudo -S`), and resolves with its
 * exit code and output instead of throwing, since the caller tells a refused password from a failed
 * command by both. Unlike `createExec` it never logs its arguments or input; its one log line names
 * only the program and the exit code.
 */
export function runWithInput(file: string, args: string[], opts: RunWithInputOptions, spawn: LaunchSpawn = nodeSpawn): Promise<InputRunResult> {
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      ...(opts.env !== undefined ? { env: { ...process.env, ...opts.env } } : {}),
    })
    let stdout = ''
    let stderr = ''
    const keep = (sofar: string, chunk: Buffer): string => (sofar + chunk.toString('utf8')).slice(-MAX_CAPTURE)
    child.stdout?.on('data', (chunk: Buffer) => { stdout = keep(stdout, chunk) })
    child.stderr?.on('data', (chunk: Buffer) => { stderr = keep(stderr, chunk) })
    const timer = setTimeout(() => { child.kill('SIGTERM') }, opts.timeoutMs)
    let settled = false
    const settle = (code: number | null, extra = ''): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      log.debug(opts.scope, 'input command finished', { file, code })
      resolve({ code, stdout, stderr: stderr + extra })
    }
    child.on('error', (error: Error) => { settle(null, error.message) })
    child.on('close', (code: number | null) => { settle(code) })
    // A process that exits before reading stdin makes this write fail with EPIPE; its exit code is the answer.
    child.stdin?.on('error', () => { /* The exit code says what happened. */ })
    child.stdin?.end(opts.input)
  })
}

/**
 * `launchDetached` for a helper that must read secret input on stdin first (a macOS install helper
 * under `sudo -S`): detached, no shell, output ignored, unref'd, and the input written then closed.
 */
export function launchDetachedWithInput(file: string, args: string[], input: string, scope: LogScope, spawn: LaunchSpawn = nodeSpawn): void {
  const child = spawn(file, args, { detached: true, stdio: ['pipe', 'ignore', 'ignore'], shell: false })
  child.on?.('error', (error: Error) => {
    log.warn(scope, 'launch failed', { command: file, error: error.message })
  })
  child.stdin?.on('error', () => { /* The helper reports through its result file. */ })
  child.stdin?.end(input)
  child.unref?.()
}
