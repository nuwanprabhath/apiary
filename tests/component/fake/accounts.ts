/**
 * Claude accounts in the fake, modelled on `AccountService` (src/main/accounts): `main` is always
 * there and cannot be removed, an id is the label's slug made unique, renaming keeps the id, removing the default falls
 * back to `main`, a session with no recorded account (or a removed one) runs under the default,
 * and every change tells every window with `accountsChanged`. The contract
 * (`tests/contract/clauses/accounts.ts`) pins it.
 */
import type { ApiaryApi } from '@shared/api'
import { MAIN_ACCOUNT_ID, accountSlug, type AccountsState } from '@shared/domain/accounts'
import { asAccountId, asSessionId, type AccountId, type SessionId } from '@shared/domain/ids'
import type { Env } from './state'

type AccountsApi = Pick<ApiaryApi,
  'accountsList' | 'accountsAdd' | 'accountsRename' | 'accountsRemove' | 'accountsSetDefault' | 'sessionAccountGet'
  | 'accountsLogin' | 'sessionAccountSwitch' | 'sessionAccountsList'>

const FAKE_HOME = '/fixture'

export function initialAccounts(): AccountsState {
  return { accounts: [{ id: MAIN_ACCOUNT_ID, label: 'Main', email: null, isMain: true }], defaultId: MAIN_ACCOUNT_ID }
}

export function accountsApi(env: Env): AccountsApi {
  const { state, emit } = env
  const accountOf = (sessionId: string): AccountId => {
    const stored = state.sessionAccounts.get(sessionId)
    return state.accounts.accounts.some((a) => a.id === stored) ? asAccountId(stored ?? '') : state.accounts.defaultId
  }
  /** The sessions running as a chat; the fake has no terminals, so these are the live ones. */
  const live = (): Record<SessionId, AccountId> => {
    const out: Record<SessionId, AccountId> = {}
    for (const [id, chat] of state.chats) if (chat.status !== 'exited') out[asSessionId(id)] = accountOf(id)
    return out
  }
  const set = (next: AccountsState): void => {
    state.accounts = next
    emit('accountsChanged', state.accounts)
  }
  return {
    accountsList: async () => state.accounts,
    accountsAdd: async (label) => {
      const id = asAccountId(accountSlug(label, new Set(state.accounts.accounts.map((a) => a.id))))
      set({ ...state.accounts, accounts: [...state.accounts.accounts, { id, label: label.trim(), email: null, isMain: false }] })
      return id
    },
    accountsRename: async (id, label) => {
      if (!state.accounts.accounts.some((a) => a.id === id)) throw new Error(`Unknown account ${id}`)
      set({ ...state.accounts, accounts: state.accounts.accounts.map((a) => (a.id === id ? { ...a, label: label.trim() } : a)) })
    },
    accountsRemove: async (id) => {
      if (id === MAIN_ACCOUNT_ID) throw new Error('The main account cannot be removed')
      if (!state.accounts.accounts.some((a) => a.id === id)) return
      set({
        accounts: state.accounts.accounts.filter((a) => a.id !== id),
        defaultId: state.accounts.defaultId === id ? MAIN_ACCOUNT_ID : state.accounts.defaultId,
      })
    },
    accountsSetDefault: async (id) => {
      if (!state.accounts.accounts.some((a) => a.id === id)) throw new Error(`Unknown account ${id}`)
      set({ ...state.accounts, defaultId: id })
    },
    sessionAccountGet: async (sessionId) => accountOf(sessionId),
    accountsLogin: async (id) => {
      if (!state.accounts.accounts.some((a) => a.id === id)) throw new Error(`Unknown account ${id}`)
      return env.newSession(FAKE_HOME)
    },
    sessionAccountSwitch: async (sessionId, id) => {
      if (!state.accounts.accounts.some((a) => a.id === id)) throw new Error(`Unknown account ${id}`)
      state.sessionAccounts.set(sessionId, id)
      emit('sessionAccountsChanged', live())
    },
    sessionAccountsList: async () => live(),
  }
}
