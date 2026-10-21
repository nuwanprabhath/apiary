import { describe, it, expect } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'

/**
 * The tab in front is marked by a shape no status uses: a bar under its name. A running tab's glow
 * is a lit ring with a halo, which outshone the quiet chip that used to be the only mark, so the
 * glowing tab next to it read as the one in front, and a reply went to the wrong chat.
 */
const RUNNING = '11111111-1111-1111-1111-111111111111'

async function twoTabs(status: (key: string) => 'running' | 'idle'): Promise<void> {
  await renderApp({}, (f) => {
    f.override('activeTabs', async () => f.state.tabs.map((t) => ({ ...t, status: status(t.key) })))
  })
  await userEvent.click(sidebarSession('Fix CSV export bug'))
  await userEvent.click(sidebarSession('Add worktree switcher'))
  await until(() => document.querySelectorAll('[data-testid="session-tab"]').length === 2)
}

const tabs = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-testid="session-tab"]')]
const marker = (tab: HTMLElement): CSSStyleDeclaration => getComputedStyle(tab, '::before')
const inkOf = (cssColor: string): string => {
  const probe = document.createElement('span')
  probe.style.color = cssColor
  document.body.append(probe)
  const out = getComputedStyle(probe).color
  probe.remove()
  return out
}

/** `color` as the browser resolves it (a token, or a `color-mix` of tokens). */
const resolved = (color: string): string => inkOf(color)

describe('the tab in front', () => {
  it('lights its bottom edge, clear of the name, in a soft text colour, beside a tab that glows', async () => {
    await twoTabs((key) => (key === RUNNING ? 'running' : 'idle'))
    await until(() => tabs().some((t) => t.dataset.glow === 'running'))
    const front = tabs().find((t) => t.dataset.active === 'true')!
    const glowing = tabs().find((t) => t.dataset.glow === 'running')!
    expect(front).not.toBe(glowing)

    const edge = marker(front)
    expect(edge.content).not.toBe('none')
    // On the chip's own edge, not an underline under the name.
    expect(parseFloat(edge.bottom)).toBe(0)
    expect(parseFloat(edge.height)).toBeLessThanOrEqual(2)
    expect(parseFloat(edge.width)).toBeGreaterThan(front.getBoundingClientRect().width / 2)
    expect(edge.backgroundColor).toBe(resolved('color-mix(in sRGB, var(--text) 45%, transparent)'))
    // The other tab, glowing or not, has none.
    expect(marker(glowing).content).toBe('none')
  })

  it('when it is the running one, the glow\'s own bottom edge is brighter instead of a line of its own', async () => {
    await twoTabs(() => 'running')
    await until(() => tabs().every((t) => t.dataset.glow === 'running'))
    const front = tabs().find((t) => t.dataset.active === 'true')!
    const edge = marker(front)
    expect(parseFloat(edge.bottom)).toBe(0)
    expect(edge.height).toBe(getComputedStyle(front).getPropertyValue('--glow-width').trim())
    expect(edge.backgroundColor).toBe(resolved('color-mix(in sRGB, var(--status-running) 45%, var(--text))'))
    expect(marker(tabs().find((t) => t !== front)!).content).toBe('none')
  })
})
