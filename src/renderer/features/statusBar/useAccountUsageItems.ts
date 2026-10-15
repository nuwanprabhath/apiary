import { useMemo } from 'react'
import { usageItemId } from '@shared/domain/accounts'
import type { SessionId } from '@shared/domain/ids'
import type { StatusBarItem } from '@shared/domain/statusBar'
import { hasSeveralAccounts, useAccounts, useSessionAccount } from '../../state/accountsStore'
import { sessionIdOfTabKey, useWorkspaceSelector } from '../workspace'

/** The plugin whose items are one per account (`main/statusBar/claudeUsage/plugin.ts`). */
const USAGE_PLUGIN = 'claude-usage'

/** The session in the focused pane, or null when it shows none (empty, or a session still starting). */
function useFocusedSession(): SessionId | null {
  const key = useWorkspaceSelector((state) => {
    const pane = state.layout.panes.find((p) => p.id === state.activeColumnId) ?? state.layout.panes[0]
    const active = pane?.activeKey ?? null
    return active === null || state.pending.has(active) ? null : active
  })
  return key === null ? null : sessionIdOfTabKey(key)
}

const isAccountMeter = (i: StatusBarItem): boolean =>
  i.pluginId === USAGE_PLUGIN && i.action.kind !== 'consent' && (i.id === 'usage' || i.id.startsWith('usage:'))

/**
 * Only the usage meter of the account the focused session runs under, or the default account's
 * when no pane has a session. With one account nothing is hidden, so the bar reads as it always did.
 * The consent question is not a meter and always shows.
 */
export function useAccountUsageItems(items: StatusBarItem[]): StatusBarItem[] {
  const accounts = useAccounts()
  const sessionAccount = useSessionAccount(useFocusedSession())
  const shown = usageItemId(sessionAccount ?? accounts.defaultId)
  const several = hasSeveralAccounts(accounts)
  return useMemo(
    () => (several ? items.filter((i) => !isAccountMeter(i) || i.id === shown) : items),
    [items, several, shown],
  )
}
