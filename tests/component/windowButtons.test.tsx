import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'
import type { FakeApiary } from './fakeApiary'
import { WINDOW_PICTURE } from '../contract/world'

/**
 * The status bar's window buttons: one per Apiary window, as a taskbar has. This window is number 1
 * (the fake's), so its button is the pressed one.
 */
function threeWindows(fake: FakeApiary): void {
  fake.state.appWindows = [
    { number: 1, title: 'Fix CSV export bug', focused: true, minimized: false, remoteHost: null },
    { number: 2, title: 'Add worktree switcher', focused: false, minimized: false, remoteHost: null },
    { number: 3, title: 'Repo root session', focused: false, minimized: true, remoteHost: null },
  ]
  // Window 2's Claude is working, window 3's waits for an answer.
  fake.state.tabs = [
    { windowNumber: 2, key: 'w2-tab', view: 'terminal', status: 'running', label: 'Working one' },
    { windowNumber: 3, key: 'w3-tab', view: 'terminal', status: 'waiting', label: 'Waiting one' },
  ]
}

const buttons = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-testid="window-button"]')]
const button = (n: number): HTMLElement => document.querySelector<HTMLElement>(`[data-testid="window-button"][data-window="${String(n)}"]`)!

describe('the window buttons', () => {
  it('are not there with one window', async () => {
    await renderApp({})
    await expect.element(page.getByTestId('sidebar-refresh')).toBeVisible()
    expect(document.querySelector('[data-testid="window-buttons"]')).toBeNull()
  })

  it('show every window by its active tab, this one pressed, and what each one\'s Claude is doing', async () => {
    await renderApp({}, threeWindows)
    await until(() => buttons().length === 3)
    expect(buttons().map((b) => b.textContent)).toEqual(['Fix CSV export bug', 'Add worktree switcher', 'Repo root session'])
    expect(buttons().map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
    await expect.poll(() => button(2).dataset.glow).toBe('running')
    expect(button(3).dataset.glow).toBe('waiting')
    expect(button(1).dataset.glow).toBeUndefined()
    expect(button(3).dataset.minimized).toBe('true')
    expect(button(3).getAttribute('aria-label')).toBe('Window 3: Repo root session (Waiting for you)')
  })

  it('a click brings that window to the front; this window\'s own does nothing', async () => {
    const { fake } = await renderApp({}, threeWindows)
    await until(() => buttons().length === 3)
    await userEvent.click(button(3))
    await until(() => fake.callsTo('appWindowRaise').length === 1)
    expect(fake.callsTo('appWindowRaise')).toEqual([[3]])
    // Main says it is restored: it is no longer drawn minimised.
    await expect.poll(() => button(3).dataset.minimized).toBeUndefined()
    await userEvent.click(button(1))
    expect(fake.callsTo('appWindowRaise')).toEqual([[3]])
  })

  it('hovering shows a picture of the window, with what it is doing', async () => {
    const { fake } = await renderApp({}, threeWindows)
    await until(() => buttons().length === 3)
    await userEvent.hover(button(2))
    await expect.element(page.getByTestId('window-preview')).toBeVisible()
    await expect.poll(() => page.getByTestId('window-preview-picture').element().querySelector('img')?.getAttribute('src')).toBe(WINDOW_PICTURE)
    await expect.element(page.getByTestId('window-preview-status')).toHaveTextContent('Claude is working')
    expect(fake.callsTo('appWindowPreview')[0]).toEqual([2])
    await userEvent.unhover(button(2))
    await expect.element(page.getByTestId('window-preview')).not.toBeInTheDocument()
  })

  it('names the window after its active tab, which is what the buttons read back', async () => {
    await renderApp({})
    await expect.poll(() => document.title).toBe('Apiary')
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await expect.poll(() => document.title).toBe('Fix CSV export bug — Apiary')
  })
})
