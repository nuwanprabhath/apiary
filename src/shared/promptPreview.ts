/**
 * The pure half of the shorten-the-prompt setting, shared by both processes.
 *
 * `previewPrompt` is here rather than beside `promptPathEnv` because Settings draws it and the
 * renderer cannot import from `src/main`. It reproduces bash's measured behaviour; see
 * `src/main/pty/promptPath.ts` for the measurements.
 */

/** The most components worth keeping; past this nothing is being shortened. */
export const MAX_SEGMENTS = 8

export interface PromptPathOptions {
  enabled: boolean
  /** How many trailing directories to keep. */
  segments: number
  /** Show nothing but `$` (the "Minimal prompt" setting). Takes precedence over the trim. */
  minimal?: boolean
}

/** The count bash is given, whatever a hand-edited settings file says. */
export function clampSegments(segments: number): number {
  return Math.min(Math.max(Math.round(segments), 1), MAX_SEGMENTS)
}

/**
 * What `\w` will expand to for `path`, so Settings can show the answer: "keep the last N
 * directories" is not obvious on a worktree path, where N=2 shortens almost nothing.
 */
export function previewPrompt(path: string, { enabled, segments, minimal = false }: PromptPathOptions): string {
  if (minimal) return '$'
  const home = path.startsWith('~')
  const body = home ? path.slice(1).replace(/^\//, '') : path.replace(/^\//, '')
  const parts = body.split('/').filter((p) => p !== '')
  if (!enabled) return path

  const keep = clampSegments(segments)
  if (parts.length <= keep) return path
  // Bash keeps the tilde and puts the ellipsis after it; an absolute path loses its leading slash to it.
  const tail = parts.slice(-keep).join('/')
  return home ? `~/.../${tail}` : `.../${tail}`
}
