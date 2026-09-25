import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateTheme, type ThemeReport } from '@shared/theme/validate'
import { buildThemePrompt, extractThemeJson, THEME_JSON_SCHEMA } from '@shared/theme/prompt'
import type { ThemeSpec } from '@shared/theme/spec'
import { childEnv } from '../pty/childEnv'
import { loginShell } from '../pty/resumeCommand'
import { log } from '../log/logger'

export const THEME_MODELS = ['sonnet', 'haiku', 'opus'] as const
export type ThemeModel = typeof THEME_MODELS[number]

const MAX_STDOUT = 64 * 1024

/**
 * Asks the user's own `claude` to design a theme — and gives it nothing to do but answer.
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
 * Whatever comes back is only ever passed on through `validateTheme`.
 */
export class ThemeGenerator {
  private child: ChildProcess | null = null
  private cancelled = false

  constructor(private readonly opts: { claudeBin: () => string | null; timeoutMs?: number; shell?: string }) {}

  get busy(): boolean { return this.child !== null }

  cancel(): void {
    if (this.child === null) return
    this.cancelled = true
    this.child.kill('SIGTERM')
  }

  async generate(req: { request: string; current: ThemeSpec | null; model: ThemeModel }): Promise<{ spec: ThemeSpec; report: ThemeReport }> {
    if (this.child !== null) throw new Error('Already generating a theme.')
    const request = req.request.trim()
    if (request === '') throw new Error('Describe the theme you would like.')
    const model: ThemeModel = (THEME_MODELS as readonly string[]).includes(req.model) ? req.model : 'sonnet'
    const args = [
      '-p', '--output-format', 'json', '--model', model,
      '--tools', '', '--safe-mode', '--strict-mcp-config', '--no-session-persistence',
      '--json-schema', JSON.stringify(THEME_JSON_SCHEMA),
      buildThemePrompt({ request, current: req.current }),
    ]
    const bin = this.opts.claudeBin() ?? 'claude'
    const cwd = mkdtempSync(join(tmpdir(), 'apiary-theme-'))
    const started = Date.now()
    const kind = req.current === null ? 'generate' : 'refine'
    log.info('theme', 'generation started', { kind, model })
    this.cancelled = false
    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        const child = spawn(this.opts.shell ?? loginShell(), ['-l', '-c', 'exec "$0" "$@"', bin, ...args], {
          cwd, env: childEnv(process.env), stdio: ['ignore', 'pipe', 'pipe'],
        })
        this.child = child
        let out = ''
        let err = ''
        let settled = false
        const finish = (fn: () => void): void => { if (!settled) { settled = true; clearTimeout(timer); fn() } }
        const timer = setTimeout(() => {
          finish(() => { reject(new Error('Claude took too long to answer. Try again, or a shorter description.')) })
          child.kill('SIGTERM')
        // A full theme took Sonnet 45–55 s on real requests (live spec), so 90 s was too close.
        }, this.opts.timeoutMs ?? 150_000)
        child.stdout?.on('data', (d: Buffer) => {
          out += d.toString('utf8')
          if (out.length > MAX_STDOUT) {
            finish(() => { reject(new Error("Claude's reply was too large to be a theme.")) })
            child.kill('SIGTERM')
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
      const raw = extractThemeJson(stdout)
      if (raw === null) throw new Error("Claude's reply had no theme in it. Try describing it differently.")
      const result = validateTheme(raw)
      log.info('theme', 'generation finished', {
        kind, model, ms: Date.now() - started, bytes: stdout.length, ...result.report,
      })
      return result
    } catch (e) {
      log.warn('theme', 'generation failed', { kind, model, ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) })
      throw e
    } finally {
      this.child = null
      rmSync(cwd, { recursive: true, force: true })
    }
  }
}
