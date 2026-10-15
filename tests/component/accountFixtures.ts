import { asAccountId } from '@shared/domain/ids'
import type { AccountsState } from '@shared/domain/accounts'
import type { StatusBarItem } from '@shared/domain/statusBar'

/** The two accounts the status-bar scenarios use: main, and "Work" (signed in as another person). */
export const TWO_ACCOUNTS: AccountsState = {
  accounts: [
    { id: asAccountId('main'), label: 'Main', email: 'me@example.com', isMain: true },
    { id: asAccountId('work'), label: 'Work', email: 'me@work.example', isMain: false },
  ],
  defaultId: asAccountId('main'),
}

const meter = (id: string, text: string, title: string): StatusBarItem => ({
  pluginId: 'claude-usage', id, icon: 'gauge', text, title, tone: 'normal', action: { kind: 'panel' }, detail: [],
})

/** What main sends with two accounts: a labelled meter for each, then the shared refresh. */
export const TWO_ACCOUNT_ITEMS: StatusBarItem[] = [
  meter('usage', 'Main · 5h 10% · 7d 2%', 'Claude usage (Main)'),
  meter('usage:work', 'Work · 5h 64% · 7d 31%', 'Claude usage (Work)'),
  {
    pluginId: 'claude-usage', id: 'refresh', icon: 'refresh', text: '', title: 'Refresh Claude usage now',
    tone: 'normal', action: { kind: 'refresh' }, detail: [],
  },
]

/** The same bar with one account: main's meter as it always read. */
export const ONE_ACCOUNT_ITEMS: StatusBarItem[] = [
  meter('usage', '5h 10% · 7d 2%', 'Claude usage'),
  TWO_ACCOUNT_ITEMS[2],
]
