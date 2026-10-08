import { describe, it, expect, afterEach } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession } from './helpers'
import type { StatusBarItem } from '@shared/domain/statusBar'

/**
 * The renderer's one error policy (state/policy.ts), seen from the window: a command the user
 * started that fails says so, and a background one that fails is logged and stays out of the way.
 * Each of these used to be swallowed (`.catch(() => {})`, a bare `void`).
 */
const toast = (): string | undefined => document.querySelector('[data-testid="notification-message"]')?.textContent ?? undefined
const REFRESH: StatusBarItem = {
  pluginId: 'claude-usage', id: 'refresh', icon: 'refresh', text: '', title: 'Refresh Claude usage now',
  tone: 'normal', action: { kind: 'refresh' }, detail: [],
}

afterEach(() => { history.replaceState(null, '', location.pathname) })

describe('error policy', () => {
  it('a status bar refresh that fails is shown', async () => {
    const { fake } = await renderApp({ statusBar: [REFRESH] })
    fake.override('statusBarRefresh', () => Promise.reject(new Error('plugin crashed')))
    await userEvent.click(page.getByTestId('status-item-claude-usage-refresh'))
    await expect.poll(toast).toBe('Could not refresh the status bar: plugin crashed')
  })

  it('a menu item that fails to run is shown', async () => {
    history.replaceState(null, '', `${location.pathname}?chrome=custom`)
    const { fake } = await renderApp()
    fake.override('appMenuInvoke', () => Promise.reject(new Error('no such command')))
    await userEvent.click(page.getByTestId('menu-bar-file'))
    await userEvent.click(page.getByTestId('menu-bar-dropdown').getByRole('menuitem', { name: /Settings/ }))
    await expect.poll(toast).toBe('Could not run that menu item: no such command')
  })

  it('a rename that main refuses is shown', async () => {
    const { fake } = await renderApp()
    fake.override('renameSession', () => Promise.reject(new Error('read-only file')))
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('session-title-edit'))
    await userEvent.fill(page.getByTestId('session-title-input'), 'Renamed')
    await userEvent.keyboard('{Enter}')
    await expect.poll(toast).toBe('Could not rename the session: read-only file')
  })

  it('a background read that fails is logged, not shown', async () => {
    const { fake } = await renderApp({}, (f) => { f.override('themeGpuCompositing', () => Promise.reject(new Error('no gpu info')) ) })
    await expect.element(page.getByTestId('sidebar')).toBeVisible()
    expect(toast()).toBeUndefined()
    expect(fake.callsTo('logWrite').some((a) => a[2] === 'background task failed')).toBe(true)
  })
})
