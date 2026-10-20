import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { sidebarSession, until } from '../helpers'
import { reviewUi } from './review'

/** The shell pane's list of terminals: three open with the second in front (highlighted as the
 *  sidebar's selected session is), and one being renamed with its name selected. */
async function openList(): Promise<void> {
  await renderApp()
  await userEvent.click(sidebarSession('Fix CSV export bug'))
  await userEvent.click(page.getByTestId('shell-toggle'))
  await until(() => document.querySelector('[data-testid="terminal-shell"]') !== null)
  await userEvent.click(page.getByTestId('terminal-add'))
  await userEvent.click(page.getByTestId('terminal-add'))
  await until(() => page.getByTestId('terminal-tab-row').elements().length === 3)
  await userEvent.click(page.getByTestId('terminal-tab-row').all()[1].getByTestId('terminal-tab-label'), { position: { x: 8, y: 8 } })
}

const card = (): Element | null => document.querySelector('[data-testid="shell-card"]')

describe('UI terminal list', () => {
  it('three terminals, the second in front', async () => {
    await openList()
    await reviewUi('terminal list active row', { widths: [900, 1400], within: card })
  })

  it('a terminal being renamed', async () => {
    await openList()
    await reviewUi('terminal list rename', {
      widths: [900, 1400],
      within: card,
      open: async () => {
        if (document.querySelector('[data-testid="terminal-tab-rename-input"]') !== null) return
        await userEvent.dblClick(page.getByTestId('terminal-tab-row').all()[1].getByTestId('terminal-tab-label'), { position: { x: 8, y: 8 } })
        await until(() => document.querySelector('[data-testid="terminal-tab-rename-input"]') !== null)
      },
    })
  })
})
