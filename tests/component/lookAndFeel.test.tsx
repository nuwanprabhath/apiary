import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp, type Rendered } from './renderApp'
import { sidebarSession, box, mouse, until } from './helpers'

/**
 * The floating-panel look: the sidebar, each editor pane and its shell are rounded cards on the
 * window background, a gap apart, and every gap is its divider's resize target with a pill-shaped
 * handle in it — the VS Code arrangement the user asked for.
 */

async function open(): Promise<Rendered> {
  const rendered = await renderApp()
  await userEvent.click(sidebarSession('Fix CSV export bug'))
  await userEvent.click(page.getByTestId('shell-toggle'))
  await expect.element(page.getByTestId('terminal-shell')).toBeVisible()
  return rendered
}

const radius = (testId: string): number =>
  parseFloat(getComputedStyle(document.querySelector(`[data-testid="${testId}"]`)!).borderTopLeftRadius)

describe('look and feel', () => {
  it('the sidebar, the session and its shell are rounded cards a gap apart', async () => {
    await open()
    for (const id of ['sidebar', 'session-card', 'shell-card']) expect(radius(id)).toBeGreaterThanOrEqual(6)

    const s = box(page.getByTestId('sidebar'))
    const c = box(page.getByTestId('session-card'))
    const sh = box(page.getByTestId('shell-card'))
    expect(c.x - (s.x + s.width)).toBeGreaterThanOrEqual(4)
    expect(sh.y - (c.y + c.height)).toBeGreaterThanOrEqual(4)
    // No divider lines: the gap does that job now.
    expect(getComputedStyle(document.querySelector('[data-testid="sidebar"]')!).borderRightWidth).toBe('0px')
  })

  it('every gap has a grab handle that answers the pointer, and dragging it resizes', async () => {
    await open()
    const resizer = page.getByTestId('sidebar-resizer')
    const pillOf = (el: Element): { opacity: string; height: string } => {
      const st = getComputedStyle(el, '::after')
      return { opacity: st.opacity, height: st.height }
    }
    expect(pillOf(resizer.element()).height).toBe('18px')
    await userEvent.hover(resizer)
    await until(() => pillOf(resizer.element()).opacity === '1')

    const before = box(page.getByTestId('sidebar')).width
    const r = box(resizer)
    await mouse.move(r.x + r.width / 2, r.y + r.height / 2)
    await mouse.down()
    await mouse.move(r.x + r.width / 2 + 60, r.y + r.height / 2, 5)
    await mouse.up()
    expect(box(page.getByTestId('sidebar')).width).toBeGreaterThan(before + 40)

    const bottom = page.getByTestId('bottom-resizer')
    expect(pillOf(bottom.element()).height).toBe('4px')
    await userEvent.hover(bottom)
    await until(() => pillOf(bottom.element()).opacity === '1')

    await userEvent.click(page.getByTestId('session-tab-split'))
    const column = document.querySelector('[data-testid="column-resizer"]')!
    await userEvent.hover(column)
    await until(() => pillOf(column).opacity === '1')
  })

  it('a scrollbar shows while its list scrolls, and hides again when left alone', async () => {
    const { fake } = await open()
    fake.emit('openSettingsDialog')
    await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)
    await userEvent.click(page.getByTestId('settings-nav-themes'))

    const pane = document.querySelector<HTMLElement>('[data-testid="settings-pane"]')!
    pane.scrollTop = 120
    await until(() => pane.getAttribute('data-scrolling') === '')
    await until(() => pane.getAttribute('data-scrolling') === null)
    expect(pane.getAttribute('data-scrolling')).toBeNull()
  })

  it('every corner follows the theme: unchanged on the original look, rounder on a rounder theme', async () => {
    const { fake } = await open()
    const token = (name: string): number => {
      const probe = document.createElement('div')
      probe.style.width = `var(${name})`
      document.body.append(probe)
      const w = probe.getBoundingClientRect().width
      probe.remove()
      return w
    }
    // The original look, exactly as before corners were derived from the panel radius.
    expect(token('--radius-sm')).toBe(4)
    expect(token('--radius-row')).toBe(5)
    expect(token('--radius-lg')).toBe(10)
    expect(radius('shell-toggle')).toBe(6)

    await fake.themeApply('builtin:glass')
    await until(() => document.querySelector('html')?.getAttribute('data-material') === 'glass')
    const panel = radius('shell-card')
    expect(panel).toBe(14)
    // The Hide shell button sits a few pixels inside the card's corner: it has to be about as
    // round as that corner minus the inset, not a fixed 6px that reads as square next to it.
    for (const id of ['shell-toggle', 'sidebar-refresh', 'session-tab']) {
      expect(radius(id)).toBeGreaterThanOrEqual(panel * 0.6)
    }
    expect(token('--radius-sm')).toBe(7)
    expect(token('--radius-lg')).toBeCloseTo(17.5)
  })

  it('a terminal ends its last row the same distance above the card edge at any height', async () => {
    await open()
    const gaps: number[] = []
    for (const dy of [0, 7, 13]) {
      const r = box(page.getByTestId('bottom-resizer'))
      await mouse.move(r.x + r.width / 2, r.y + 3)
      await mouse.down()
      await mouse.move(r.x + r.width / 2, r.y + 3 - dy, 2)
      await mouse.up()
      // Settles layout/transition after the drag before measuring pixel geometry below; there is
      // no visible-state condition to assert on instead.
      await new Promise((resolve) => setTimeout(resolve, 300))
      const host = document.querySelector('[data-testid="terminal-shell"]')!.closest('.terminal-host')!
      const hostRect = host.getBoundingClientRect()
      const screenRect = host.querySelector('.xterm-screen')!.getBoundingClientRect()
      gaps.push(Math.round(hostRect.bottom - screenRect.bottom))
    }
    // Rows anchored to the bottom: the leftover sliver goes to the top, so two panes side by side
    // (a Claude session and its neighbour) end their text at the same height.
    expect(new Set(gaps).size).toBe(1)
  })

  it('the active tab is a lifted chip, not an accent-coloured bar', async () => {
    await open()
    const tab = document.querySelector<HTMLElement>('[data-testid="session-tab"][data-active="true"]')!
    const accentProbe = document.createElement('div')
    accentProbe.style.color = 'var(--accent)'
    document.body.append(accentProbe)
    const accent = getComputedStyle(accentProbe).color
    accentProbe.remove()
    const st = getComputedStyle(tab)
    expect(st.boxShadow).not.toContain(accent)
    expect(st.boxShadow).not.toBe('none')
    expect(st.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  })
})
