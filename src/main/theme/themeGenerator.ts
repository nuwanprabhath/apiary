import { validateTheme, type ThemeReport } from '@shared/theme/validate'
import { errorMessage } from '@shared/errors'
import { buildThemePrompt, extractThemeJson, THEME_JSON_SCHEMA } from '@shared/theme/prompt'
import type { ThemeSpec } from '@shared/theme/spec'
import type { ClaudeOneShot } from '../claude/claudeOneShot'
import { log } from '../log/logger'
import { THEME_MODELS, type ThemeModel } from '@shared/theme/models'

export { THEME_MODELS, type ThemeModel } from '@shared/theme/models'

/**
 * Asks the user's own `claude` to design a theme — through `ClaudeOneShot`, which gives it nothing
 * to do but answer (no tools, none of the user's customisations, an empty folder, no session file).
 *
 * Whatever comes back is only ever passed on through `validateTheme`.
 */
export class ThemeGenerator {
  private readonly runner: ClaudeOneShot

  /** `runner` is built in the container, over the configured `claude`. */
  constructor(private readonly opts: { runner: ClaudeOneShot; timeoutMs?: number }) {
    this.runner = opts.runner
  }

  get busy(): boolean { return this.runner.busy }

  cancel(): void { this.runner.cancel() }

  async generate(req: { request: string; current: ThemeSpec | null; model: ThemeModel }): Promise<{ spec: ThemeSpec; report: ThemeReport }> {
    if (this.runner.busy) throw new Error('Already generating a theme.')
    const request = req.request.trim()
    if (request === '') throw new Error('Describe the theme you would like.')
    const model: ThemeModel = (THEME_MODELS as readonly string[]).includes(req.model) ? req.model : 'sonnet'
    const started = Date.now()
    const kind = req.current === null ? 'generate' : 'refine'
    log.info('theme', 'generation started', { kind, model })
    try {
      const stdout = await this.runner.run({
        prompt: buildThemePrompt({ request, current: req.current }),
        model,
        jsonSchema: THEME_JSON_SCHEMA,
        // A full theme took Sonnet 45–55 s on real requests (live spec), so 90 s was too close.
        timeoutMs: this.opts.timeoutMs ?? 150_000,
        what: 'a theme',
        tag: 'theme',
      })
      const raw = extractThemeJson(stdout)
      if (raw === null) throw new Error("Claude's reply had no theme in it. Try describing it differently.")
      const result = validateTheme(raw)
      log.info('theme', 'generation finished', {
        kind, model, ms: Date.now() - started, bytes: stdout.length, ...result.report,
      })
      return result
    } catch (e) {
      log.warn('theme', 'generation failed', { kind, model, ms: Date.now() - started, error: errorMessage(e) })
      throw e
    }
  }
}
