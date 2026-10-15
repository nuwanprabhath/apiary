import type { AccountService } from '../../accounts/accountService'
import type { ChatService } from '../../chat/chatService'
import type { AppService } from '../../appService'
import type { Handlers } from '../registrar'

type HandledKeys = 'accountsList' | 'accountsAdd' | 'accountsRemove' | 'accountsSetDefault' | 'sessionAccountGet'
  | 'accountsLogin' | 'sessionAccountSwitch' | 'sessionAccountsList'

/**
 * The contract's guards have already checked the label's length and the ids' shape; the service
 * creates or removes the folder, saves the list and tells every window with `accountsChanged`.
 * Removing an account that a live terminal or chat runs under is refused here, where both are known.
 */
export function accountsHandlers(
  accounts: AccountService, chat: ChatService, service: AppService,
): Pick<Handlers, HandledKeys> {
  return {
    accountsList: () => accounts.list(),
    accountsAdd: (_e, label) => accounts.add(label),
    accountsRemove: (_e, id) => {
      if (chat.accountInUse(id)) {
        const label = accounts.list().accounts.find((a) => a.id === id)?.label ?? id
        throw new Error(`Close the sessions using ${label} first`)
      }
      accounts.remove(id)
    },
    accountsSetDefault: (_e, id) => { accounts.setDefault(id) },
    sessionAccountGet: (_e, sessionId) => accounts.accountOf(sessionId),
    accountsLogin: (_e, id) => service.loginToAccount(accounts.resolve(id)),
    sessionAccountSwitch: (_e, sessionId, id) => chat.switchAccount(sessionId, accounts.resolve(id)),
    sessionAccountsList: () => chat.liveSessionAccounts(),
  }
}
