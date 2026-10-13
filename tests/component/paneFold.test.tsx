import { describe, it, expect } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { settled, until } from './helpers'
import { foldButton, markRunning, openLayout, panes } from './paneFoldSetup'

/** Folding a pane that shares its column with another down to its tab bar. */

const height = (el: Element): number => el.getBoundingClientRect().height
const card = (pane: Element): Element => pane.querySelector('[data-testid="session-card"]')!
const bar = (pane: Element): Element => pane.querySelector('[data-testid="session-tab-bar"]')!
const heights = (): string => panes().map((p) => height(p).toFixed(1)).join(' ')

describe('folding a pane', () => {
  it('in two rows, the folded top is its tab bar and the bottom takes the rest; unfolding restores them', async () => {
    await renderApp()
    await openLayout('halves-v')
    const [top, bottom] = panes()
    const before = [height(top), height(bottom)]

    await userEvent.click(foldButton(top)!)
    await until(() => top.getAttribute('data-folded') === 'true')
    await settled(heights)
    expect(Math.abs(height(card(top)) - height(bar(top)))).toBeLessThanOrEqual(1)
    expect(foldButton(top)!.getAttribute('aria-expanded')).toBe('false')
    const content = document.querySelector('[data-testid="content"]')!
    expect(Math.abs(height(top) + height(bottom) - height(content))).toBeLessThanOrEqual(1)
    expect(height(bottom)).toBeGreaterThan(before[1] + 100)
    // The last open pane of the stack can fold too: the other one opens in its place.
    expect(foldButton(bottom)!.hasAttribute('disabled')).toBe(false)
    await userEvent.click(foldButton(bottom)!)
    await until(() => bottom.getAttribute('data-folded') === 'true' && top.getAttribute('data-folded') === 'false')
    await userEvent.click(foldButton(bottom)!)
    await until(() => bottom.getAttribute('data-folded') === 'false')
    await userEvent.click(foldButton(top)!)
    await until(() => top.getAttribute('data-folded') === 'true')

    await userEvent.click(foldButton(top)!)
    await until(() => top.getAttribute('data-folded') === 'false')
    await settled(heights)
    expect(Math.abs(height(top) - before[0])).toBeLessThanOrEqual(1)
    expect(Math.abs(height(bottom) - before[1])).toBeLessThanOrEqual(1)
  })

  it('in a grid, folding top-left gives bottom-left the space and leaves top-right alone', async () => {
    await renderApp()
    await openLayout('grid')
    const [topLeft, topRight, bottomLeft] = panes()
    const before = [height(topRight), height(bottomLeft)]

    await userEvent.click(foldButton(topLeft)!)
    await until(() => topLeft.getAttribute('data-folded') === 'true')
    await settled(heights)
    expect(Math.abs(height(topRight) - before[0])).toBeLessThanOrEqual(1)
    expect(height(bottomLeft)).toBeGreaterThan(before[1] + 100)
    expect(topRight.getAttribute('data-folded')).toBe('false')
  })

  it('a folded pane whose tab is running says so; an idle one does not', async () => {
    const { fake } = await renderApp()
    await openLayout('halves-v')
    const [top] = panes()
    await userEvent.click(foldButton(top)!)
    await until(() => top.getAttribute('data-folded') === 'true')
    expect(top.hasAttribute('data-pane-activity')).toBe(false)

    // Marked on every poll: the window's own debounced tab report (after the fold) resets it.
    const key = top.getAttribute('data-session-key')!
    await until(() => {
      markRunning(fake, key)
      return top.getAttribute('data-pane-activity') === 'running'
    })
    // The whole folded bar wears the tabs' travelling border glow.
    expect(top.querySelector('[data-testid="session-card"]')?.getAttribute('data-glow')).toBe('running')
  })

  it('a pane with no vertical neighbour has no fold control', async () => {
    await renderApp()
    await openLayout('main-right2')
    const [main, right] = panes()
    expect(foldButton(main)).toBeNull()
    expect(foldButton(right)).not.toBeNull()
  })

  it('clicking a tab in a folded pane unfolds it and shows that tab', async () => {
    await renderApp()
    await openLayout('halves-v', ['Fix CSV export bug', 'Add worktree switcher'])
    const [top] = panes()
    await userEvent.click(foldButton(top)!)
    await until(() => top.getAttribute('data-folded') === 'true')

    const tab = [...top.querySelectorAll<HTMLElement>('[data-testid="session-tab"]')]
      .find((t) => t.textContent?.includes('Fix CSV export bug'))!
    await userEvent.click(tab.querySelector('button') ?? tab)
    await until(() => top.getAttribute('data-folded') === 'false')
    expect(top.querySelector('[data-testid="transcript"]')).not.toBeNull()
    expect(top.textContent).toContain('Fix CSV export bug')
  })
})
