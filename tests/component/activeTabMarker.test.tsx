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

describe('the tab in front', () => {
  it('carries a bar under its name, in the text colour, beside a running tab that glows', async () => {
    await twoTabs((key) => (key === RUNNING ? 'running' : 'idle'))
    await until(() => tabs().some((t) => t.dataset.glow === 'running'))
    const front = tabs().find((t) => t.dataset.active === 'true')!
    const glowing = tabs().find((t) => t.dataset.glow === 'running')!
    expect(front).not.toBe(glowing)

    const bar = marker(front)
    expect(bar.content).not.toBe('none')
    expect(parseFloat(bar.height)).toBeGreaterThanOrEqual(2)
    expect(parseFloat(bar.width)).toBeGreaterThan(front.getBoundingClientRect().width / 2)
    expect(bar.backgroundColor).toBe(inkOf(getComputedStyle(document.documentElement).getPropertyValue('--text')))
    // The other tab, glowing or not, has none.
    expect(marker(glowing).content).toBe('none')
  })

  it('keeps the bar while it is the running one itself, under its glow', async () => {
    await twoTabs(() => 'running')
    await until(() => tabs().every((t) => t.dataset.glow === 'running'))
    const front = tabs().find((t) => t.dataset.active === 'true')!
    expect(marker(front).content).not.toBe('none')
    expect(marker(tabs().find((t) => t !== front)!).content).toBe('none')
  })
})
