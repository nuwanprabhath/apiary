import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Reads the Claude Code OAuth access token — the same places Claude Code itself keeps it, and the
 * same order as the claude-usage-stats VS Code extension: on macOS the Keychain item
 * "Claude Code-credentials", then `<config>/.credentials.json` on every platform.
 *
 * The token is used for one request to Anthropic's usage endpoint and nothing else. It never
 * leaves this module except as that request's Authorization header, and is never logged.
 *
 * `useKeychain` is false whenever Apiary is pointed at a config root other than the real one (the
 * test harness's fixture home): a Keychain read can put a macOS permission prompt on the screen.
 */
export async function readAccessToken(opts: {
  configRoot: string
  useKeychain: boolean
  readKeychain?: () => Promise<string | undefined>
}): Promise<string | undefined> {
  if (opts.useKeychain) {
    const token = extractToken(await (opts.readKeychain ?? readMacKeychain)())
    if (token !== undefined) return token
  }
  try {
    return extractToken(await readFile(join(opts.configRoot, '.credentials.json'), 'utf8'))
  } catch {
    return undefined
  }
}

export function extractToken(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined
  try {
    const token = (JSON.parse(raw) as { claudeAiOauth?: { accessToken?: unknown } }).claudeAiOauth?.accessToken
    return typeof token === 'string' && token.length > 0 ? token : undefined
  } catch {
    return undefined
  }
}

function readMacKeychain(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      'security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { timeout: 10_000 },
      (err, stdout) => { resolve(err ? undefined : stdout.trim()) },
    )
  })
}
