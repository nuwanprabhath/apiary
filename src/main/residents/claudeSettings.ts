import { shellQuote } from '../exec/shellQuote'

/** The settings file a kind with `pathFirst` writes in its space and its claude gets with `--settings`. */
export const CLAUDE_SETTINGS_FILE = 'claude-settings.json'

/**
 * Claude Code settings whose SessionStart hook puts `dir` first on the Bash tool's PATH. The Bash
 * tool runs in a snapshot of the user's login shell, whose profile may prepend its own folders
 * (`~/.local/bin` holding another `mra`); `$CLAUDE_ENV_FILE` is sourced after that snapshot, before
 * every command, so an export written there wins.
 */
export function pathFirstSettings(dir: string): unknown {
  const exportLine = `export PATH=${shellQuote(dir)}:"$PATH"`
  return {
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: `printf '%s\\n' ${shellQuote(exportLine)} >> "$CLAUDE_ENV_FILE"` }] }],
    },
  }
}
