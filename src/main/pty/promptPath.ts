import { clampSegments, type PromptPathOptions } from '@shared/promptPath'

export type { PromptPathOptions }

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
 *
 * **And not bash 3.2 either.** `PROMPT_DIRTRIM` arrived in bash 4.0, and macOS still ships 3.2 as
 * `/bin/bash`, where it is ignored in silence. Measured on both: bash 3.2 printed the whole path
 * unchanged with the variable set, bash 5.3 printed `[.../pipeline-issues/paratoo-core]`.
 *
 * **What the count counts**, also measured rather than assumed, because it is the thing that made
 * the setting look broken. For `~/dirtrim-probe/projects/deep.worktrees/pipeline-issues`:
 *
 * ```
 * DIRTRIM=1 -> ~/.../pipeline-issues
 * DIRTRIM=2 -> ~/.../deep.worktrees/pipeline-issues
 * DIRTRIM=4 -> ~/dirtrim-probe/projects/deep.worktrees/pipeline-issues
 * ```
 *
 * The tilde survives and is not itself one of the N. So N is a count of *directories kept*, not a
 * budget of width — and on the paths this feature exists for, where one component is often
 * `something.worktrees`, keeping two of them shortens almost nothing. That is why the default is
 * one: the identifying part of a worktree path is the last component, and everything before it is
 * what was in the way.
 */

/**
 * The extra environment a shell should be spawned with, empty when the setting is off.
 *
 * Returned as a whole environment fragment rather than a single value so the caller does not have
 * to know which variable does the work — the day this grows a zsh path, only this file changes.
 */
export function promptPathEnv({ enabled, segments }: PromptPathOptions): Record<string, string> {
  if (!enabled) return {}
  return { PROMPT_DIRTRIM: String(clampSegments(segments)) }
}
