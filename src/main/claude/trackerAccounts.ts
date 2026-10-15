import { join } from 'node:path'
import type { PtySessionInfo } from '@shared/api'
import { asSessionId } from '@shared/domain/ids'
import type { AccountService } from '../accounts/accountService'
import type { PtyManager } from '../pty/ptyManager'

/** What the tracker needs of the accounts: where each one's pid files are, and a session's account to record. */
export type TrackerAccounts = Pick<AccountService, 'configRootFor' | 'setAccountOf'>

/** Every live `claude` pty with its pid and the `sessions` folder of the account it runs under. */
export function trackedProcesses(
  pty: Pick<PtyManager, 'tuiProcesses'>, mainRoot: string, accounts: TrackerAccounts,
): Map<string, { pid: number; sessionsDir: string }> {
  const out = new Map<string, { pid: number; sessionsDir: string }>()
  for (const [id, { pid, accountId }] of pty.tuiProcesses()) {
    const root = accountId === null ? mainRoot : accounts.configRootFor(accountId)
    out.set(id, { pid, sessionsDir: join(root, 'sessions') })
  }
  return out
}

/**
 * Every session a `claude` pty is on belongs to the account the process runs under: a new session
 * remembers the default it started in, a fork its parent's, and the conversation `/clear` starts
 * inside a running terminal (same pty id, new session id) the account of that terminal.
 */
export function rememberAccounts(
  sessions: Record<string, PtySessionInfo>, pty: Pick<PtyManager, 'accountOf'>, accounts: TrackerAccounts,
): void {
  for (const [ptyId, info] of Object.entries(sessions)) {
    const account = pty.accountOf(ptyId)
    if (account !== null) accounts.setAccountOf(asSessionId(info.sessionId), account)
  }
}
