import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
 * The minimal prompt — nothing but `$` — which, unlike the trim, has to replace the prompt, and a
 * shell's own startup files set theirs *after* the environment is read. So it is done at the
 * last moment each shell offers, after everything the user's files did:
 *
 * - **bash**: `PROMPT_COMMAND` runs before every prompt is drawn, so setting `PS1` there wins over
 *   `.bashrc`. Works in bash 3.2 (macOS's `/bin/bash`) as well as 5.x. A `.bashrc` that assigns
 *   `PROMPT_COMMAND` outright replaces it, and that prompt is then left alone — degrading to the
 *   user's own prompt, never to a broken one.
 * - **zsh**: no variable reaches the prompt, so `ZDOTDIR` points at a small shim (the technique VS
 *   Code's shell integration uses). Each shim file sources the user's real one from their own
 *   `ZDOTDIR` (or `$HOME`), and `.zshrc` then appends a `precmd` hook that sets `PROMPT` — hooks run
 *   in order, so it runs after any theme's own.
 *
 * `\$` / `%(!.#.$)` so a root shell still shows `#`.
 */
const MINIMAL_BASH = "PS1='\\$ '"

const ZSH_FILES = ['.zshenv', '.zprofile', '.zshrc', '.zlogin'] as const

/** One shim file: run the user's own copy with their ZDOTDIR in force, then put ours back. */
function zshShimFile(name: typeof ZSH_FILES[number]): string {
  const lines = [
    '# Written by Apiary for its "Minimal prompt" setting. Runs your own file, then restores Apiary\'s ZDOTDIR.',
    `if [[ -f "\${APIARY_USER_ZDOTDIR:-$HOME}/${name}" ]]; then`,
    '  APIARY_ZDOTDIR="$ZDOTDIR"',
    '  ZDOTDIR="${APIARY_USER_ZDOTDIR:-$HOME}"',
    `  . "$ZDOTDIR/${name}"`,
    '  APIARY_USER_ZDOTDIR="$ZDOTDIR"',
    '  ZDOTDIR="$APIARY_ZDOTDIR"',
    'fi',
  ]
  if (name === '.zshrc') {
    lines.push(
      '_apiary_minimal_prompt() { PROMPT=\'%(!.#.$) \'; RPROMPT=\'\' }',
      'typeset -ga precmd_functions',
      'precmd_functions+=(_apiary_minimal_prompt)',
    )
  }
  return lines.join('\n') + '\n'
}

/** Writes the zsh shim into `dir` (idempotent) and returns it, for `promptPathEnv`. */
export function writeZshShim(dir: string): string {
  mkdirSync(dir, { recursive: true })
  for (const name of ZSH_FILES) writeFileSync(join(dir, name), zshShimFile(name))
  return dir
}

/**
 * The extra environment a shell should be spawned with, empty when both settings are off.
 *
 * Returned as a whole environment fragment rather than a single value so the caller does not have
 * to know which variables do the work.
 */
export function promptPathEnv(
  { enabled, segments, minimal = false }: PromptPathOptions,
  zshShim: string | null = null,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  if (minimal) {
    const out: Record<string, string> = { PROMPT_COMMAND: MINIMAL_BASH }
    if (zshShim !== null) {
      out.ZDOTDIR = zshShim
      out.APIARY_USER_ZDOTDIR = env.ZDOTDIR ?? env.HOME ?? ''
    }
    return out
  }
  if (!enabled) return {}
  return { PROMPT_DIRTRIM: String(clampSegments(segments)) }
}
