import { existsSync, readFileSync, statSync } from 'node:fs'
import { isRecord } from '@shared/guards'
import { writeJsonAtomic } from '../fs/atomicWrite'

function readObject(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return isRecord(parsed) ? { ...parsed } : {}
  } catch {
    return {}
  }
}

/** What changes when Claude rewrites a `.claude.json` (a login, a logout): its mtime and size. Null when it is missing. */
export function claudeJsonStamp(file: string): string | null {
  try {
    const st = statSync(file)
    return `${String(st.mtimeMs)}:${String(st.size)}`
  } catch {
    return null
  }
}

/** The signed-in email in a `.claude.json` (`oauthAccount.emailAddress`); null when the file is missing, unreadable or not signed in. */
export function readOauthEmail(claudeJson: string): string | null {
  const account = readObject(claudeJson).oauthAccount
  return isRecord(account) && typeof account.emailAddress === 'string' ? account.emailAddress : null
}

/**
 * Copies what an account should share with the main login out of the main `.claude.json`: the MCP
 * servers and each project's `hasTrustDialogAccepted`, so a new account does not re-ask. Every other
 * key (the login, history, counters) stays as the account has it. Written atomically.
 */
export function syncClaudeJson(mainClaudeJson: string, accountClaudeJson: string): void {
  const main = readObject(mainClaudeJson)
  const account = readObject(accountClaudeJson)
  if (main.mcpServers !== undefined) account.mcpServers = main.mcpServers
  if (isRecord(main.projects)) {
    const projects = isRecord(account.projects) ? { ...account.projects } : {}
    for (const [path, entry] of Object.entries(main.projects)) {
      if (!isRecord(entry) || entry.hasTrustDialogAccepted === undefined) continue
      const own = projects[path]
      projects[path] = { ...(isRecord(own) ? own : {}), hasTrustDialogAccepted: entry.hasTrustDialogAccepted }
    }
    account.projects = projects
  }
  writeJsonAtomic(accountClaudeJson, account)
}
