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

  it('has no arrows while the tabs fit', async () => {
    await page.viewport(1400, 700)
    await renderApp()
    await userEvent.click(sidebarSession(TITLES[0]))
    await until(() => document.querySelectorAll('[data-testid="session-tab"]').length === 1)
    expect(document.querySelector('[data-testid="session-tab-scroll-left"]')).toBeNull()
    expect(document.querySelector('[data-testid="session-tab-scroll-right"]')).toBeNull()
  })
})

describe('the tab bar\'s arrows, when the tabs overflow', () => {
  const arrow = (side: 'left' | 'right'): HTMLButtonElement => document.querySelector<HTMLButtonElement>(`[data-testid="session-tab-scroll-${side}"]`)!

  async function overflowing(): Promise<void> {
    await page.viewport(760, 700)
    await renderApp()
    for (const title of TITLES) await userEvent.click(sidebarSession(title))
    await until(() => document.querySelector('[data-testid="session-tab-scroll-right"]') !== null)
    strip().scrollLeft = 0
    await until(() => arrow('left').disabled && !arrow('right').disabled)
  }

  it('page through the tabs, each disabled at its own end, and the strip fades at the side with more', async () => {
    await overflowing()
    expect(strip().dataset.moreRight).toBe('true')
    expect(strip().dataset.moreLeft).toBe('false')
    expect(getComputedStyle(arrow('right')).display).not.toBe('none')
    const width = strip().clientWidth
    await userEvent.click(arrow('right'))
    await until(() => strip().scrollLeft > 0 && !arrow('left').disabled)
    expect(strip().dataset.moreLeft).toBe('true')
    expect(strip().clientWidth).toBe(width)
    // Each page settles before the next click: a click scrolls smoothly from wherever the strip is,
    // so clicking mid-scroll restarts it and CI's slower runner never reached the end.
    const end = (): number => strip().scrollWidth - strip().clientWidth
    const page = Math.max(80, strip().clientWidth * 0.75)
    for (let i = 0; i < 20 && !arrow('right').disabled; i++) {
      const target = Math.min(end(), strip().scrollLeft + page)
      arrow('right').click()
      await until(() => arrow('right').disabled || strip().scrollLeft >= target - 1)
    }
    // The arrows follow the strip's scroll events through React state, a frame behind the scroll.
    await until(() => arrow('right').disabled)
    expect(Math.ceil(strip().scrollLeft + strip().clientWidth)).toBeGreaterThanOrEqual(strip().scrollWidth - 1)
    arrow('left').click()
    await until(() => !arrow('right').disabled)
  })

  it('scroll while a dragged tab is held over them, to drop it past the tabs in view', async () => {
    await overflowing()
    const data = new DataTransfer()
    data.setData('application/x-apiary-tab', 'any')
    for (let i = 0; i < 5; i++) arrow('right').dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }))
    expect(strip().scrollLeft).toBeGreaterThan(0)
    // Anything else held over them (a file) does nothing.
    strip().scrollLeft = 0
    const file = new DataTransfer()
    file.setData('text/plain', 'x')
    arrow('right').dispatchEvent(new DragEvent('dragover', { dataTransfer: file, bubbles: true, cancelable: true }))
    expect(strip().scrollLeft).toBe(0)
  })

  it('a strip too narrow for them and a tab does without them; the wheel still scrolls it', async () => {
    await page.viewport(620, 700)
    await renderApp()
    for (const title of TITLES) await userEvent.click(sidebarSession(title))
    await until(() => strip().scrollWidth > strip().clientWidth)
    await until(() => document.querySelector('[data-testid="session-tab-scroll-right"]') !== null)
    expect(getComputedStyle(arrow('right')).display).toBe('none')
    strip().scrollLeft = 0
    expect(wheel(120).defaultPrevented).toBe(true)
    expect(strip().scrollLeft).toBeGreaterThan(0)
  })
})
