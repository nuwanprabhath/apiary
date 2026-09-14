/**
 * Shortening the working directory in a shell's own prompt.
 *
 * A worktree path like `~/projects/paratoo-fdcp.worktrees/pipeline-issues/paratoo-core` takes most
 * of a narrow terminal's first line before a single character has been typed, and the part that
 * identifies it is the end.
 *
 * This is done with `PROMPT_DIRTRIM` rather than by writing a prompt. `PROMPT_DIRTRIM` is bash's
 * own setting for exactly this: it tells bash to keep only the last N components when it expands
 * `\\w`, so whatever prompt the user has configured keeps its colours, its git segment and its
 * shape — only the path inside it gets shorter. Replacing `PS1` would mean overwriting a prompt
 * someone has spent years arranging, from a checkbox in a settings dialog, which is not a trade
 * anybody would take.
 *
 * **This reaches bash and not zsh.** zsh has no equivalent variable — trimming there means editing
 * `PROMPT` itself (`%2~`), which is the destructive thing above, or injecting a `ZDOTDIR` shim
 * ahead of the user's own `.zshrc`. Neither is worth it for a cosmetic setting, so a zsh prompt is
 * left alone and the setting says so.
 */

/** The most components worth keeping; past this nothing is being shortened. */
const MAX_SEGMENTS = 8

export interface PromptPathOptions {
  enabled: boolean
  /** How many trailing directories to keep. */
  segments: number
}

/**
 * The extra environment a shell should be spawned with, empty when the setting is off.
 *
 * Returned as a whole environment fragment rather than a single value so the caller does not have
 * to know which variable does the work — the day this grows a zsh path, only this file changes.
 */
export function promptPathEnv({ enabled, segments }: PromptPathOptions): Record<string, string> {
  if (!enabled) return {}
  const clamped = Math.min(Math.max(Math.round(segments), 1), MAX_SEGMENTS)
  return { PROMPT_DIRTRIM: String(clamped) }
}
