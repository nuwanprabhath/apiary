import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { childEnv } from '../pty/childEnv'
import { loginShell } from '../pty/resumeCommand'

/** SIGTERM to the child's whole process group (it is spawned detached, as the group leader). */
function killGroup(child: ChildProcess): void {
  try {
    if (child.pid !== undefined) { process.kill(-child.pid, 'SIGTERM'); return }
  } catch { /* already gone, or no group: fall back to the child alone */ }
  child.kill('SIGTERM')
}

export interface OneShotRequest {
  prompt: string
  /** A `--model` alias (`haiku`, `sonnet`, `opus`). */
  model: string
  /** When given, the answer is structured output matching it (`--json-schema`). */
  jsonSchema?: object
  timeoutMs: number
  /** stdout beyond this is not an answer anyone asked for; the run is ended. */
  maxStdout?: number
  /** Short words for the errors: "a theme", "a pet". */
  what: string
  /** Prefix for the temporary directory, so a leftover one says whose it was. */
  tag: string
}

/**
 * Asks the user's own `claude` one question — and gives it nothing to do but answer. Shared by the
 * theme designer and the pets.
 *
 * `--tools ""` leaves it no tools at all; `--safe-mode` and `--strict-mcp-config` drop the user's
 * CLAUDE.md, skills, hooks, plugins and MCP servers; `--no-session-persistence` keeps the
 * exchange out of ~/.claude/projects (and so out of Apiary's own sidebar). It runs in a fresh empty
 * directory that is removed afterwards, with another session's markers stripped (`childEnv`).
 *
 * It is launched through the login shell the way sessions are, because that is what puts an
 * nvm or Homebrew `claude` on PATH for an app started from the Dock. The shell is handed a fixed
 * command and every argument as its own positional parameter — nothing the user typed is ever
 * part of a command line a shell parses.
 *
 * One run at a time per instance; a caller that wants two at once makes two.
 */
export class ClaudeOneShot {
  private child: ChildProcess | null = null
  private cancelled = false
  /** Settles the running call as cancelled, without waiting for the process to exit. */
  private abort: (() => void) | null = null

  constructor(private readonly opts: { claudeBin: () => string | null; shell?: string }) {}

  get busy(): boolean { return this.child !== null }

  cancel(): void {
    if (this.child === null) return
    this.cancelled = true
    killGroup(this.child)
    this.abort?.()
  }

  /** Resolves with claude's stdout (a `--output-format json` envelope); rejects with a message fit to show. */
  async run(req: OneShotRequest): Promise<string> {
    if (this.child !== null) throw new Error(`Already working on ${req.what}.`)
    const args = [
      '-p', '--output-format', 'json', '--model', req.model,
      '--tools', '', '--safe-mode', '--strict-mcp-config', '--no-session-persistence',
      ...(req.jsonSchema !== undefined ? ['--json-schema', JSON.stringify(req.jsonSchema)] : []),
      req.prompt,
    ]
    const bin = this.opts.claudeBin() ?? 'claude'
    const cwd = mkdtempSync(join(tmpdir(), `apiary-${req.tag}-`))
    const maxStdout = req.maxStdout ?? 64 * 1024
    this.cancelled = false
    try {
      return await new Promise<string>((resolve, reject) => {
        // Its own process group, so cancel and the timeout can end everything it started: `claude`
        // (or a wrapper script) may have children of its own, and one left holding stdout would
        // keep the call "running" until it finished by itself.
        const child = spawn(this.opts.shell ?? loginShell(), ['-l', '-c', 'exec "$0" "$@"', bin, ...args], {
          cwd, env: childEnv(process.env), stdio: ['ignore', 'pipe', 'pipe'], detached: true,
        })
        this.child = child
        let out = ''
        let err = ''
        let settled = false
        const finish = (fn: () => void): void => { if (!settled) { settled = true; clearTimeout(timer); fn() } }
        this.abort = () => { finish(() => { reject(new Error('Cancelled.')) }) }
        const timer = setTimeout(() => {
          finish(() => { reject(new Error('Claude took too long to answer. Try again, or a shorter description.')) })
          killGroup(child)
        }, req.timeoutMs)
        child.stdout?.on('data', (d: Buffer) => {
          out += d.toString('utf8')
          if (out.length > maxStdout) {
            finish(() => { reject(new Error(`Claude's reply was too large to be ${req.what}.`)) })
            killGroup(child)
          }
        })
        child.stderr?.on('data', (d: Buffer) => { if (err.length < 4096) err += d.toString('utf8') })
        child.on('error', (e) => { finish(() => { reject(new Error(`Claude could not be run: ${e.message}`)) }) })
        child.on('close', (code) => {
          finish(() => {
            if (this.cancelled) reject(new Error('Cancelled.'))
            else if (code !== 0) reject(new Error(`Claude could not be run (exit ${String(code)}). ${err.trim().split('\n').slice(-1)[0] ?? ''}`.trim()))
            else resolve(out)
          })
        })
      })
    } finally {
      this.child = null
      this.abort = null
      rmSync(cwd, { recursive: true, force: true })
    }
  }
}
