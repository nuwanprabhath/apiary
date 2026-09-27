import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Resolves the Claude Code config root. CLAUDE_CONFIG_DIR wins when set to a
 * non-empty value; otherwise ~/.claude.
 */
export function resolveConfigRoot(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const override = env.CLAUDE_CONFIG_DIR
  if (override && override.trim() !== '') return override
  return join(home, '.claude')
}

export function projectsDir(configRoot: string): string {
  return join(configRoot, 'projects')
}
