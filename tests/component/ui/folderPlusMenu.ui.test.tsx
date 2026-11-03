import { describe, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import { reviewUi } from './review'

const menuOpen = (): boolean => document.querySelector('[data-testid="new-in-folder-menu"]') !== null

/** The "+" of a git folder row (repo-c in the fixture). */
function plusOfRepoC(): HTMLElement {
  const row = [...document.querySelectorAll<HTMLElement>('.project-row-wrap')]
    .find((r) => r.querySelector('.project-label')?.textContent === 'repo-c')
  const plus = row?.querySelector<HTMLElement>('[data-testid="new-session-button"]')
  if (plus === null || plus === undefined) throw new Error('no "+" on repo-c')
  return plus
}

describe('UI: a git folder\'s "+" menu', () => {
  it('the menu open, its row highlighted and no path card over it', async () => {
    await renderApp()
    await until(() => document.querySelectorAll('.project-row-wrap').length > 0)
    await reviewUi('folder plus menu', {
      open: async () => {
        await userEvent.click(plusOfRepoC())
        await until(menuOpen)
      },
      close: () => userEvent.keyboard('{Escape}'),
    })
  })
})
