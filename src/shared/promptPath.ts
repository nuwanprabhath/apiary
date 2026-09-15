/**
 * The pure half of the shorten-the-prompt setting, shared by both processes.
 *
 * `previewPrompt` is here rather than beside `promptPathEnv` because Settings draws it, and the
 * renderer cannot import from `src/main` — it has no Node, and `tsconfig.node.json` has no DOM, so
 * a module pulled across that line drags a whole project's libs with it. The rule this file exists
 * to obey is the one already written into the codebase: a pure helper wanted on both sides lives
 * apart from anything that touches `window` or `process`.
 *
 * The behaviour it reproduces is bash's, measured rather than inferred. See
 * `src/main/pty/promptPath.ts` for the measurements.
 */

/** The most components worth keeping; past this nothing is being shortened. */
const MAX_SEGMENTS = 8

export interface PromptPathOptions {
  enabled: boolean
  /** How many trailing directories to keep. */
  segments: number
}

/** The count bash will actually be given, whatever a hand-edited settings file says. */
export function clampSegments(segments: number): number {
  return Math.min(Math.max(Math.round(segments), 1), MAX_SEGMENTS)
}

/**
 * What `\w` will expand to for `path`, so Settings can show the answer instead of describing it.
 *
 * "Keep the last N directories" is a rule whose effect on *your* paths is not obvious — the whole
 * reason this setting looked broken is that N=2 on a worktree path shortens almost nothing. A line
 * of example under the control turns that from something to reason about into something to look
 * at, and it costs nothing: this reproduces the measured bash behaviour exactly, so what it shows
 * is what the shell will print.
 */
export function previewPrompt(path: string, { enabled, segments }: PromptPathOptions): string {
  const home = path.startsWith('~')
  const body = home ? path.slice(1).replace(/^\//, '') : path.replace(/^\//, '')
  const parts = body.split('/').filter((p) => p !== '')
  if (!enabled) return path

  const keep = clampSegments(segments)
  if (parts.length <= keep) return path
  // Bash keeps the tilde and puts the ellipsis after it; an absolute path loses its leading slash
  // to the ellipsis instead. Both measured, not guessed.
  const tail = parts.slice(-keep).join('/')
  return home ? `~/.../${tail}` : `.../${tail}`
}
