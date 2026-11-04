import { join } from 'node:path'
import type { PtySessionInfo } from '@shared/api'
import { asSessionId } from '@shared/domain/ids'
import type { AccountService } from '../accounts/accountService'
import type { PtyManager } from '../pty/ptyManager'
import { readClaudeSession } from './claudeSessionTracker'

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
 * The live `claude` ptys on `sessionId` now, read from each one's pid file rather than the tracker's
 * last poll. A new session's terminal keeps its `new:…` pty id, so its id never says which session
 * it is on.
 */
export function ptysOnSession(
  pty: Pick<PtyManager, 'tuiProcesses'>, mainRoot: string, accounts: TrackerAccounts, sessionId: string,
): string[] {
  return [...trackedProcesses(pty, mainRoot, accounts)]
    .filter(([, p]) => readClaudeSession(p.sessionsDir, p.pid)?.sessionId === sessionId)
    .map(([id]) => id)
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
