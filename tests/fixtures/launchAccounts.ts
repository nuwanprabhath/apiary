import type { LaunchAccounts } from '../../src/main/accounts/accountService'
import type { AccountId } from '@shared/domain/ids'
import { MAIN_ACCOUNT_ID } from '@shared/domain/accounts'
import { asAccountId } from '@shared/domain/ids'

export const WORK = asAccountId('work')

/**
 * The launchers' view of the accounts without a folder behind it: `main` is the default and has no
 * environment; `work` has `CLAUDE_CONFIG_DIR=/accounts/work`. `stored` is what `setAccountOf` wrote.
 */
export function stubAccounts(defaultId: AccountId = MAIN_ACCOUNT_ID): LaunchAccounts & { stored: Map<string, AccountId>; prepared: AccountId[] } {
  const stored = new Map<string, AccountId>()
  const prepared: AccountId[] = []
  return {
    stored, prepared,
    launchEnv: (id): Record<string, string> => { prepared.push(id); return id === MAIN_ACCOUNT_ID ? {} : { CLAUDE_CONFIG_DIR: `/accounts/${id}` } },
    accountOf: (sessionId) => stored.get(sessionId) ?? defaultId,
    setAccountOf: (sessionId, id) => { stored.set(sessionId, id) },
    defaultId: () => defaultId,
  }
}
