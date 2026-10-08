import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createExec } from '../../exec/run'
import type { ConsentPrompt } from '@shared/domain/statusBar'
import type { Consent } from './consent'

/**
 * What the user is asked, once, before Apiary first reads Claude Code's sign-in. Kept beside the
 * code it describes: change what is read or where it is sent, and this text changes in the same diff.
 */
export const CONSENT_PROMPT: ConsentPrompt = {
  title: 'Show your Claude usage?',
  lines: [
    'To show your plan’s 5-hour and weekly limits, Apiary reads Claude Code’s sign-in token: from the macOS Keychain (the item “Claude Code-credentials”, where macOS may ask you to allow it) or from the credentials file in Claude’s config folder.',
    'The token is sent only to Anthropic’s usage endpoint (api.anthropic.com), the one Claude Code’s own /usage reads. It goes nowhere else.',
    'Apiary never logs or stores the token. It is read for each request and dropped.',
    'If you decline, this plugin is turned off. You can turn it back on in Settings, Plugins, and you will be asked again.',
  ],
  allow: 'Allow',
  deny: 'Don’t allow',
}

/**
 * Reads the Claude Code OAuth access token — the same places Claude Code itself keeps it, and the
 * same order as the claude-usage-stats VS Code extension: on macOS the Keychain item
 * "Claude Code-credentials", then `<config>/.credentials.json` on every platform.
 *
 * The token is used for one request to Anthropic's usage endpoint and nothing else. It never
 * leaves this module except as that request's Authorization header, and is never logged.
 *
 * Nothing is read without a `Consent` (consent.ts): the user is asked once, before the first read,
 * and the Keychain is not touched until they have said yes (ADR-0019). This file and limits.ts are
 * the only places that may name the Keychain item, the credentials file or the usage endpoint
 * (`apiary/credentials-behind-consent`).
 *
 * `useKeychain` is false whenever Apiary is pointed at a config root other than the real one (the
 * test harness's fixture home): a Keychain read can put a macOS permission prompt on the screen.
 */
export async function readAccessToken(_consent: Consent, opts: {
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

/** A Keychain read can wait on a permission prompt the user has to answer, hence the longer timeout. */
const keychainExec = createExec({ timeoutMs: 10_000, scope: 'claude-usage' })

async function readMacKeychain(): Promise<string | undefined> {
  try {
    return (await keychainExec('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], process.cwd())).trim()
  } catch {
    return undefined
  }
}
