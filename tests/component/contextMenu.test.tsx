import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'

function folderRow(label: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('.project-row-wrap')]
    .find((r) => r.querySelector('.project-label')?.textContent === label)
}

describe('the sidebar right-click menu', () => {
  it('draws over the pane beside the sidebar on a glass theme, not under it', async () => {
    // Glass isolates each panel into its own stacking context, which trapped a menu rendered
    // inside the sidebar beneath the session pane next to it.
    try {
      await renderApp()
      await until(() => folderRow('work-a') !== undefined)
      // After mounting: the app applies its own theme as it starts, which sets this attribute.
      document.documentElement.dataset.material = 'glass'
      expect(getComputedStyle(document.querySelector('.sidebar-frame')!).isolation).toBe('isolate')
      const row = folderRow('work-a')!
      const sidebar = document.querySelector('.sidebar-frame')!.getBoundingClientRect()
      const { y, height } = row.getBoundingClientRect()
      row.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: sidebar.right - 20, clientY: y + height / 2,
      }))
      await until(() => document.querySelector('[data-testid="sidebar-menu"]') !== null)
      const menu = document.querySelector<HTMLElement>('[data-testid="sidebar-menu"]')!
      const r = menu.getBoundingClientRect()
      expect(r.right).toBeGreaterThan(sidebar.right + 20)
      const hit = document.elementFromPoint(r.right - 10, r.top + r.height / 2)
      expect(menu.contains(hit)).toBe(true)
    } finally {
      delete document.documentElement.dataset.material
    }
  })

  it('UI-26: focuses the first item on open, arrows move between items, and closing restores focus to the opener', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    const tab = document.querySelector<HTMLElement>('[data-testid="session-tab"]')!
    tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await expect.element(page.getByTestId('tab-menu')).toBeVisible()

    const items = () => [...document.querySelectorAll<HTMLElement>('[data-testid="tab-menu"] [role="menuitem"]')]
    await until(() => document.activeElement === items()[0])

    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(items()[1])
    await userEvent.keyboard('{End}')
    expect(document.activeElement).toBe(items()[items().length - 1])
    await userEvent.keyboard('{Home}')
    expect(document.activeElement).toBe(items()[0])

    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByTestId('tab-menu')).not.toBeInTheDocument()
  })
})
