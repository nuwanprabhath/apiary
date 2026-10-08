import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnLoginShell, type NoStdinLoginShell } from '../exec/spawnLoginShell'

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
  private proc: NoStdinLoginShell | null = null
  private cancelled = false
  /** Settles the running call as cancelled, without waiting for the process to exit. */
  private abort: (() => void) | null = null

  constructor(private readonly opts: { claudeBin: () => string | null; shell?: string }) {}

  get busy(): boolean { return this.proc !== null }

  cancel(): void {
    if (this.proc === null) return
    this.cancelled = true
    this.proc.signal()
    this.abort?.()
  }

  /** Resolves with claude's stdout (a `--output-format json` envelope); rejects with a message fit to show. */
  async run(req: OneShotRequest): Promise<string> {
    if (this.proc !== null) throw new Error(`Already working on ${req.what}.`)
    const flags = [
      '-p', '--output-format', 'json', '--model', req.model,
      '--tools', '', '--safe-mode', '--strict-mcp-config', '--no-session-persistence',
      ...(req.jsonSchema !== undefined ? ['--json-schema', JSON.stringify(req.jsonSchema)] : []),
    ]
    const bin = this.opts.claudeBin() ?? 'claude'
    const cwd = mkdtempSync(join(tmpdir(), `apiary-${req.tag}-`))
    const maxStdout = req.maxStdout ?? 64 * 1024
    this.cancelled = false
    try {
      return await new Promise<string>((resolve, reject) => {
        // Its own process group (`detached`), so cancel and the timeout can end everything it
        // started: `claude` (or a wrapper script) may have children of its own, and one left
        // holding stdout would keep the call "running" until it finished by itself. Settles on
        // `close`, when stdout has drained, so the whole answer is in `out`.
        const proc = spawnLoginShell(
          { command: { bin, flags, positional: [req.prompt] }, cwd, stdin: 'ignore', detached: true, shell: this.opts.shell, settleOn: 'close' },
        )
        const { child } = proc
        this.proc = proc
        let out = ''
        let err = ''
        let settled = false
        const finish = (fn: () => void): void => { if (!settled) { settled = true; clearTimeout(timer); fn() } }
        this.abort = () => { finish(() => { reject(new Error('Cancelled.')) }) }
        const timer = setTimeout(() => {
          finish(() => { reject(new Error('Claude took too long to answer. Try again, or a shorter description.')) })
          proc.signal()
        }, req.timeoutMs)
        child.stdout.on('data', (d: Buffer) => {
          out += d.toString('utf8')
          if (out.length > maxStdout) {
            finish(() => { reject(new Error(`Claude's reply was too large to be ${req.what}.`)) })
            proc.signal()
          }
        })
        child.stderr.on('data', (d: Buffer) => { if (err.length < 4096) err += d.toString('utf8') })
        void proc.exited.then(({ code, error }) => {
          finish(() => {
            if (error !== undefined) reject(new Error(`Claude could not be run: ${error.message}`))
            else if (this.cancelled) reject(new Error('Cancelled.'))
            else if (code !== 0) reject(new Error(`Claude could not be run (exit ${String(code)}). ${err.trim().split('\n').slice(-1)[0] ?? ''}`.trim()))
            else resolve(out)
          })
        })
      })
    } finally {
      this.proc = null
      this.abort = null
      rmSync(cwd, { recursive: true, force: true })
    }
  }
}
