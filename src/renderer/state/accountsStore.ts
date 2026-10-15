import { MAIN_ACCOUNT_ID, type AccountInfo, type AccountsState } from '@shared/domain/accounts'
import { asSessionId, UUID_RE, type AccountId, type SessionId } from '@shared/domain/ids'
import type { NewSessionInfo } from '@shared/types'
import { createIpcStore, createKeyedIpcStore } from './createIpcStore'

/**
 * The Claude accounts (`shared/domain/accounts.ts`) and the account each session runs under. Main
 * owns both (`main/accounts/accountService.ts`): the list and the default in `accounts.json`, a
 * session's account in the database. Every window hears `accountsChanged` after an add, a remove or
 * a new default, and `sessionAccountsChanged` after a switch.
 */
const accountsStore = createIpcStore<AccountsState>({
  scope: 'accounts',
  initial: { accounts: [], defaultId: MAIN_ACCOUNT_ID },
  fetch: () => window.apiary.accountsList(),
  subscribe: (push) => window.apiary.onAccountsChanged(push),
})

/** Every account, the main one first, and which one new sessions start in. Empty until loaded. */
export function useAccounts(): AccountsState {
  return accountsStore.useStore()
}

/** True once there is a choice to make: with only the main account nothing about accounts is shown. */
export function hasSeveralAccounts(state: AccountsState): boolean {
  return state.accounts.length > 1
}

/** The account with `id`, or null when it is not in the list (still loading, or just removed). */
export function accountById(state: AccountsState, id: AccountId | null): AccountInfo | null {
  return state.accounts.find((a) => a.id === id) ?? null
}

/**
 * The account a session runs under, by session id. Asked again whenever a switch, an account change
 * or a pty moving to another session could have changed the answer: main sends no per-session
 * value, only that something changed.
 */
const sessionAccountStore = createKeyedIpcStore<AccountId | null>({
  scope: 'accounts',
  initial: null,
  // A pane with no session yet reads the key '' and asks main nothing.
  fetch: async (sessionId) => (UUID_RE.test(sessionId) ? window.apiary.sessionAccountGet(asSessionId(sessionId)) : null),
  subscribe: (_push, invalidate) => {
    const off = [
      window.apiary.onSessionAccountsChanged(() => { invalidate() }),
      window.apiary.onAccountsChanged(() => { invalidate() }),
      window.apiary.onPtySessionsChanged(() => { invalidate() }),
    ]
    return () => { for (const f of off) f() }
  },
  keysOf: () => [],
})

/** The account `sessionId` runs under; null while it loads or when there is no session yet. */
export function useSessionAccount(sessionId: SessionId | null): AccountId | null {
  return sessionAccountStore.useStore(sessionId ?? '', (id) => (sessionId === null ? null : id))
}

/** Adds an account and answers its id. Returned: the Settings section shows an inline error. */
export const addAccount = (label: string): Promise<AccountId> => window.apiary.accountsAdd(label)

/** Removes an added account. Returned: main refuses while a session runs under it, and says why. */
export const removeAccount = (id: AccountId): Promise<void> => window.apiary.accountsRemove(id)

/** Makes `id` the account new sessions start in. Returned, for the Settings section's error line. */
export const setDefaultAccount = (id: AccountId): Promise<void> => window.apiary.accountsSetDefault(id)

/** Starts a terminal session under `id` for the user to type `/login` in; the caller opens its tab. */
export const startAccountLogin = (id: AccountId): Promise<NewSessionInfo> => window.apiary.accountsLogin(id)

/** Runs `sessionId` under `id` from now on, restarting its `claude` if one is running. */
export const switchSessionAccount = (sessionId: SessionId, id: AccountId): Promise<void> =>
  window.apiary.sessionAccountSwitch(sessionId, id)
