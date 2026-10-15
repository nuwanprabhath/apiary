import { describe, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { sidebarSession, until } from '../helpers'
import { TWO_ACCOUNTS, TWO_ACCOUNT_ITEMS } from '../accountFixtures'
import { STANDARD_SESSIONS } from '../../fixtures/standard'
import { reviewUi } from './review'

/** The status bar with two accounts and the focused session on the second one: its labelled meter. */
describe('status bar with several accounts', () => {
  it('shows the focused session\'s account meter with its label', async () => {
    await renderApp({ statusBar: TWO_ACCOUNT_ITEMS }, (fake) => {
      fake.state.accounts = TWO_ACCOUNTS
      fake.state.sessionAccounts.set(STANDARD_SESSIONS.csv.id, 'work')
    })
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await until(() => document.querySelector('[data-testid="status-item-claude-usage-usage:work"]') !== null)
    await reviewUi('status bar second account', {
      widths: [620, 1000], within: () => document.querySelector('[data-testid="status-bar"]'),
    })
  })
})
