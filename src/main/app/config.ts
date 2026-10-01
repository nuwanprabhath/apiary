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

/**
 * Whether the Claude usage plugin may read Claude Code's credentials from the macOS Keychain.
 * Only for the real, default config root: Claude Code keeps a CLAUDE_CONFIG_DIR install's
 * credentials under a different Keychain entry, and a test root (the e2e harness's, or the
 * packaged smoke's throwaway HOME — a packaged build ignores APIARY_* hooks) must never put a
 * Keychain permission prompt on the screen or spend the developer's real token.
 */
export function readsClaudeKeychain(
  platform: NodeJS.Platform,
  testConfigRoot: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (platform !== 'darwin' || testConfigRoot !== undefined) return false
  const override = env.CLAUDE_CONFIG_DIR
  return override === undefined || override.trim() === ''
}

export function projectsDir(configRoot: string): string {
  return join(configRoot, 'projects')
}
