import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { sidebarSession, until } from '../helpers'
import { reviewUi } from './review'

const menuOpen = (): boolean => document.querySelector('[data-testid="sidebar-menu"]') !== null
const press = async (keys: string): Promise<void> => { await userEvent.keyboard(keys) }

describe('UI: the session context menu', () => {
  it('session menu, unpinned', async () => {
    await renderApp()
    await until(() => document.querySelectorAll('[data-testid="session-item"]').length === 4)
    await reviewUi('session menu unpinned', {
      open: async () => {
        await userEvent.click(sidebarSession('Fix CSV export bug'), { button: 'right' })
        await until(menuOpen)
      },
      close: () => press('{Escape}'),
    })
  })

  it('session menu, pinned', async () => {
    await renderApp()
    await until(() => document.querySelectorAll('[data-testid="session-item"]').length === 4)
    await userEvent.click(sidebarSession('Fix CSV export bug'), { button: 'right' })
    await userEvent.click(page.getByTestId('context-menu-pin'))
    await until(() => document.querySelector('[data-testid="pinned-section"]') !== null)
    await reviewUi('session menu pinned', {
      open: async () => {
        const row = document.querySelector('[role="tree"][aria-label="Pinned sessions"] [role="treeitem"]') as HTMLElement
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 30 }))
        await until(menuOpen)
      },
      close: () => press('{Escape}'),
    })
  })
})
