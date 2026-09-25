import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'

/**
 * Forking a session.
 *
 * A fork is `claude --resume <id> --fork-session`, which replays the conversation into a *new*
 * session Claude mints for itself. The fake does not do that, so what is tested here is Apiary's
 * half: that the gesture exists in the sidebar too, that the fork opens named after the original.
 */
describe('forking a session', () => {
  it('forking from the sidebar works the same way', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))

    await userEvent.click(sidebarSession('Fix CSV export bug'), { button: 'right' })
    await until(() => document.querySelector('[data-testid="sidebar-menu"]') !== null)
    await userEvent.click(page.getByTestId('sidebar-menu').getByText('Fork session'))

    await until(() => document.querySelectorAll('[data-testid="session-tab"]').length === 2)
    const labels = page.getByTestId('session-tab-label').elements()
    expect(labels).toHaveLength(2)
    expect(labels[1]?.textContent).toMatch(/fork: Fix CSV export bug/)
    // And the original is untouched — that is the whole point of forking rather than continuing.
    expect(labels[0]?.textContent).toMatch(/Fix CSV export bug/)
  })
})
