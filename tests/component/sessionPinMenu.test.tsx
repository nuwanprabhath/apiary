import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'

const pinnedRows = (): number => document.querySelectorAll('[role="tree"][aria-label="Pinned sessions"] [role="treeitem"]').length

describe('session context menu: Pin and Unpin', () => {
  it('Pin from the tree menu adds the session to Pinned, Unpin removes it', async () => {
    await renderApp()
    await until(() => document.querySelectorAll('[data-testid="session-item"]').length === 4)
    await userEvent.click(sidebarSession('Fix CSV export bug'), { button: 'right' })
    await userEvent.click(page.getByTestId('context-menu-pin'))
    await until(() => pinnedRows() === 1)

    const pinned = document.querySelector('[role="tree"][aria-label="Pinned sessions"] [role="treeitem"]') as HTMLElement
    pinned.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }))
    await userEvent.click(page.getByTestId('context-menu-unpin'))
    await until(() => pinnedRows() === 0)
    expect(document.querySelector('[data-testid="pinned-section"]')).toBeNull()
  })
})
