import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { sidebarSession, until } from '../helpers'
import { reviewUi } from './review'

/**
 * The tour: the main surfaces of the app, each in the states a person opens, at a narrow and a
 * wide window and in three themes. Every state passes the UI audit, and its screenshots land in
 * ui-review/ for the lead's review.
 */

async function openSession(title = 'Fix CSV export bug'): Promise<void> {
  await renderApp()
  await userEvent.click(sidebarSession(title))
  await until(() => document.querySelector('[data-testid="transcript"]') !== null)
}

describe('UI tour', () => {
  it('a session with its transcript', async () => {
    await openSession()
    await reviewUi('session transcript')
  })

  it('the shell toolbar of a git worktree, in a narrow window', async () => {
    // The overflow menu's own states are in shellToolbar.ui.test.tsx; the old menu's 4px clipping
    // came and went with the pane's exact height, so it is not audited here.
    await openSession('Worktree session')
    await userEvent.click(page.getByTestId('shell-toggle'))
    await reviewUi('shell toolbar overflow menu', { widths: [620, 1000] })
  })
})
