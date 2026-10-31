import { describe, it, expect } from 'vitest'
import { userEvent } from 'vitest/browser'
import { STANDARD_SESSIONS } from '../fixtures/standard'
import { DETACHED_WINDOW_NUMBER } from '../contract/world'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'

/** A resident's `open_session` reaches the window in front as `openSessionRequested`. */
const tabs = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-testid="session-tab"]')]
const activeTitle = (): string | undefined => tabs().find((t) => t.dataset.active === 'true')?.textContent ?? undefined

describe('a resident opening a session', () => {
  it('an open session\'s tab is selected', async () => {
    const { fake } = await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(sidebarSession('Add worktree switcher'))
    await until(() => tabs().length === 2 && activeTitle()?.includes('Add worktree switcher') === true)
    fake.emit('openSessionRequested', STANDARD_SESSIONS.csv.id)
    await until(() => activeTitle()?.includes('Fix CSV export bug') === true)
    expect(tabs()).toHaveLength(2)
  })

  it('a session open in another window is focused there', async () => {
    const { fake } = await renderApp()
    fake.state.tabs = [{ windowNumber: DETACHED_WINDOW_NUMBER, key: STANDARD_SESSIONS.switcher.id, view: 'transcript', status: 'stopped', label: null }]
    fake.emit('openSessionRequested', STANDARD_SESSIONS.switcher.id)
    await until(() => fake.callsTo('focusTab').length === 1)
    expect(fake.callsTo('focusTab')[0]).toEqual([DETACHED_WINDOW_NUMBER, STANDARD_SESSIONS.switcher.id])
    expect(tabs()).toHaveLength(0)
  })

  it('a closed session opens in the focused pane', async () => {
    const { fake } = await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await until(() => tabs().length === 1)
    fake.emit('openSessionRequested', STANDARD_SESSIONS.repoRoot.id)
    await until(() => tabs().length === 2)
    expect(activeTitle()).toContain('Repo root session')
  })
})
