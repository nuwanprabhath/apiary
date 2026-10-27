import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'

/** The mouse wheel over the tab bar scrolls the tabs sideways, as VS Code's does. */
const TITLES = ['Fix CSV export bug', 'Add worktree switcher', 'Repo root session', 'Worktree session']

const strip = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="session-tab-strip"]')!
const wheel = (deltaY: number, deltaX = 0): WheelEvent => {
  const e = new WheelEvent('wheel', { deltaY, deltaX, bubbles: true, cancelable: true })
  strip().dispatchEvent(e)
  return e
}

describe('the tab bar and the mouse wheel', () => {
  it('scrolls the tabs sideways when they overflow, without scrolling anything else', async () => {
    await page.viewport(620, 700)
    await renderApp()
    for (const title of TITLES) await userEvent.click(sidebarSession(title))
    await until(() => strip().scrollWidth > strip().clientWidth)
    strip().scrollLeft = 0
    const e = wheel(120)
    expect(e.defaultPrevented).toBe(true)
    expect(strip().scrollLeft).toBeGreaterThan(0)
    const there = strip().scrollLeft
    wheel(-120)
    expect(strip().scrollLeft).toBeLessThan(there)
  })

  it('leaves a sideways swipe to the browser, and does nothing when the tabs fit', async () => {
    await page.viewport(1400, 700)
    await renderApp()
    await userEvent.click(sidebarSession(TITLES[0]))
    await until(() => document.querySelectorAll('[data-testid="session-tab"]').length === 1)
    expect(wheel(120).defaultPrevented).toBe(false)
    expect(wheel(0, 120).defaultPrevented).toBe(false)
  })
})
