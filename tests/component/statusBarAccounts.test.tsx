import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { asAccountId } from '@shared/domain/ids'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'
import { ONE_ACCOUNT_ITEMS, TWO_ACCOUNTS, TWO_ACCOUNT_ITEMS } from './accountFixtures'
import { STANDARD_SESSIONS } from '../fixtures/standard'

const ids = (): string[] =>
  [...document.querySelectorAll('[data-testid^="status-item-claude-usage-"]')].map((e) => e.getAttribute('data-testid')?.replace('status-item-claude-usage-', '') ?? '')

describe('the status bar with several accounts', () => {
  it('shows only the focused session\'s account item, and its label', async () => {
    await renderApp({ statusBar: TWO_ACCOUNT_ITEMS }, (fake) => {
      fake.state.accounts = TWO_ACCOUNTS
      fake.state.sessionAccounts.set(STANDARD_SESSIONS.csv.id, 'work')
    })
    // Nothing focused yet: the default account's meter.
    await until(() => ids().length > 0)
    expect(ids()).toEqual(['usage', 'refresh'])
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await until(() => ids().includes('usage:work'))
    expect(ids()).toEqual(['usage:work', 'refresh'])
    await expect.element(page.getByTestId('status-item-claude-usage-usage:work')).toHaveTextContent('Work · 5h 64% · 7d 31%')
    // A session on the default account brings main's meter back.
    await userEvent.click(sidebarSession('Add worktree switcher'))
    await until(() => ids().includes('usage'))
    expect(ids()).toEqual(['usage', 'refresh'])
  })

  it('falls back to the default account with no focused session', async () => {
    await renderApp({ statusBar: TWO_ACCOUNT_ITEMS }, (fake) => {
      fake.state.accounts = { ...TWO_ACCOUNTS, defaultId: asAccountId('work') }
    })
    await until(() => ids().length > 0)
    expect(ids()).toEqual(['usage:work', 'refresh'])
  })

  it('one account looks exactly as before', async () => {
    await renderApp({ statusBar: ONE_ACCOUNT_ITEMS })
    await until(() => ids().length > 0)
    expect(ids()).toEqual(['usage', 'refresh'])
    await expect.element(page.getByTestId('status-item-claude-usage-usage')).toHaveTextContent('5h 10% · 7d 2%')
  })
})
