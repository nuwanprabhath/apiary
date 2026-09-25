import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { sidebarSession, box, mouse, until } from './helpers'

/**
 * Arranging sessions into a layout of up to four panes, from a hover picker — the macOS
 * window-tiling gesture, applied to panes inside one window.
 */

function all(id: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)]
}
function within(root: Element, id: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)]
}
function rightClick(el: Element): void {
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
}
function row(title: string): HTMLElement {
  const el = all('session-item').find((e) => e.textContent?.includes(title))
  if (el === undefined) throw new Error(`No row for "${title}"`)
  return el.closest('.session-row-wrap') ?? el
}

/** Hovers `hoverFirst` then `button` and waits for the layout picker's own hover delay
 * (`HOVER_DELAY_MS`) to open it. Re-hovering on every poll tick would keep resetting that delay's
 * timer (`useHoverCard`'s `arm` clears and restarts it on every `mouseenter`), so the hover happens
 * once and only the wait for the picker polls. */
async function openPickerOn(button: Element, hoverFirst?: Element): Promise<HTMLElement> {
  // Up to three rests on the button: anything that moves the page under a still pointer (a late
  // reflow on a slow machine) restarts the picker's hover delay, and a pointer that stays put never
  // gets another mouseenter to start it again. A picker that never opens still fails.
  for (let attempt = 1; ; attempt++) {
    if (hoverFirst !== undefined) await userEvent.hover(hoverFirst)
    await userEvent.hover(button)
    try {
      await until(() => all('layout-picker').length > 0, 2000)
      return all('layout-picker')[0]
    } catch (e) {
      if (attempt === 3) throw e
    }
  }
}

describe('pane layouts', () => {
  it('resting on a sidebar row\'s split button offers the layouts, and a zone places the session there', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    const target = row('Add worktree switcher')
    const picker = await openPickerOn(within(target, 'split-session-button')[0], target)

    await userEvent.click(within(picker, 'layout-zone-halves-h-1')[0])

    await until(() => all('content')[0].getAttribute('data-preset') === 'halves-h')
    expect(all('session-column')).toHaveLength(2)
    expect(all('session-column')[0].textContent).toContain('Add worktree switcher')
    expect(all('session-column')[1].textContent).toContain('Fix CSV export bug')
    expect(all('layout-picker')).toHaveLength(0)
  })

  it('a plain click on the split button still opens to the side', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    const target = row('Add worktree switcher')
    await userEvent.hover(target)
    await userEvent.click(within(target, 'split-session-button')[0])
    await until(() => all('session-column').length === 2)
    expect(all('layout-picker')).toHaveLength(0)
  })

  it('a sidebar row\'s split button focuses the pane it just opened, not pane one', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    const target = row('Add worktree switcher')
    await userEvent.hover(target)
    await userEvent.click(within(target, 'split-session-button')[0])
    await until(() => all('session-column').length === 2)
    const last = all('session-column')[1]
    expect(last.textContent).toContain('Add worktree switcher')
    expect(last.getAttribute('data-active')).toBe('true')
  })

  it('the tab strip\'s split button focuses the pane it just opened', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('session-tab-split'))
    await until(() => all('session-column').length === 2)
    expect(all('session-column')[1].getAttribute('data-active')).toBe('true')
  })

  it('placing a sidebar session via the picker focuses the new pane even in a non-first zone', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    const target = row('Add worktree switcher')
    const picker = await openPickerOn(within(target, 'split-session-button')[0], target)
    // thirds-h zone 3 (0-indexed 2, testid suffix z+1) is the last zone: "Fix CSV export bug" fills
    // zone 1, zone 2 is left waiting, and the placed session lands last — not first, so a stale
    // fallback to "pane one" cannot pass this test by accident.
    await userEvent.click(within(picker, 'layout-zone-thirds-h-3')[0])
    await until(() => all('content')[0].getAttribute('data-preset') === 'thirds-h')
    expect(all('session-column')[0].textContent).toContain('Fix CSV export bug')
    expect(all('session-column')[0].getAttribute('data-active')).not.toBe('true')
    const placed = all('session-column')[all('session-column').length - 1]
    expect(placed.textContent).toContain('Add worktree switcher')
    expect(placed.getAttribute('data-active')).toBe('true')
  })

  it('a tab moved to another zone is moved, not copied', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(sidebarSession('Add worktree switcher'))
    await until(() => all('session-tab').length === 2)

    const tab = all('session-tab').find((el) => el.textContent?.includes('Add worktree switcher'))!
    const picker = await openPickerOn(within(tab, 'session-tab-layout')[0], tab)
    await userEvent.click(within(picker, 'layout-zone-halves-v-2')[0])

    await until(() => all('content')[0].getAttribute('data-preset') === 'halves-v')
    expect(within(all('session-column')[0], 'session-tab')).toHaveLength(1)
    expect(all('session-column')[0].textContent).toContain('Fix CSV export bug')
    const secondTabs = within(all('session-column')[1], 'session-tab')
    expect(secondTabs).toHaveLength(1)
    expect(secondTabs[0].textContent).toContain('Add worktree switcher')
  })

  it('Arrange… from a tab\'s menu opens the picker where the menu was', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    rightClick(all('session-tab')[0])
    await until(() => all('tab-menu').length > 0)
    await userEvent.click(page.getByTestId('context-menu-arrange'))
    await until(() => all('layout-picker').length > 0)
    const picker = all('layout-picker')[0]
    await userEvent.click(within(picker, 'layout-zone-grid-4')[0])
    await until(() => all('content')[0].getAttribute('data-preset') === 'grid')
    expect(all('session-column')).toHaveLength(4)
    expect(all('session-column')[3].textContent).toContain('Fix CSV export bug')
  })

  it('Arrange… from a sidebar session\'s menu opens that session in the chosen zone', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    rightClick(row('Repo root session'))
    await until(() => all('context-menu-arrange').length > 0)
    await userEvent.click(page.getByTestId('context-menu-arrange'))
    await until(() => all('layout-picker').length > 0)
    await userEvent.click(all('layout-zone-main-right2-1')[0])
    await until(() => all('content')[0].getAttribute('data-preset') === 'main-right2')
    expect(all('session-column')[0].textContent).toContain('Repo root session')
  })

  it('the window layout button changes the layout without moving any session', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('window-layout-button'))
    await userEvent.click(within(all('layout-picker')[0], 'layout-option-halves-v')[0])
    await until(() => all('content')[0].getAttribute('data-preset') === 'halves-v')
    expect(all('session-column')[0].textContent).toContain('Fix CSV export bug')
    expect(all('session-column')[1].getAttribute('data-placeholder')).toBe('true')
  })

  it('there is one window layout button, on the pane at the top-right corner', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('window-layout-button'))
    await userEvent.click(page.getByTestId('layout-option-grid'))
    await until(() => all('session-column').length === 4)
    expect(all('window-layout-button')).toHaveLength(1)
    expect(within(all('session-column')[1], 'window-layout-button')).toHaveLength(1)
  })

  it('arrow keys move focus in the picker and Enter chooses the focused thumbnail', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('window-layout-button'))
    await until(() => all('layout-picker').length > 0)
    await userEvent.keyboard('{ArrowRight}')
    await userEvent.keyboard('{Enter}')
    await until(() => all('content')[0].getAttribute('data-preset') === 'halves-h')
    expect(all('content')[0].getAttribute('data-preset')).toBe('halves-h')
  })

  it('the picker marks the current layout and closes on Escape', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('window-layout-button'))
    await until(() => all('layout-picker').length > 0)
    expect(all('layout-option-single')[0].getAttribute('data-current')).toBe('true')
    await userEvent.keyboard('{Escape}')
    await until(() => all('layout-picker').length === 0)
  })

  it('a divider in the grid resizes the panes either side of it', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('window-layout-button'))
    await userEvent.click(page.getByTestId('layout-option-grid'))
    await until(() => all('session-column').length === 4)
    const handle = box(page.getByTestId('row-resizer'))
    const before = all('session-column')[0].getBoundingClientRect()
    await mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await mouse.down()
    await mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 80, 5)
    await mouse.up()
    const after = all('session-column')[0].getBoundingClientRect()
    expect(after.height).toBeGreaterThan(before.height + 40)
  })

  it('closing the last tab in a pane steps the layout down', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    const target = row('Add worktree switcher')
    const picker = await openPickerOn(within(target, 'split-session-button')[0], target)
    await userEvent.click(within(picker, 'layout-zone-halves-h-2')[0])
    await until(() => all('content')[0].getAttribute('data-preset') === 'halves-h')

    const last = all('session-column')[all('session-column').length - 1]
    await userEvent.click(within(last, 'session-tab-close')[0])
    await until(() => all('content')[0].getAttribute('data-preset') === 'single')
    expect(all('session-column')).toHaveLength(1)
  })

  it('a pane waiting to be filled offers the open tabs and recent sessions', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(sidebarSession('Add worktree switcher'))
    await userEvent.click(page.getByTestId('window-layout-button'))
    await userEvent.click(page.getByTestId('layout-option-halves-h'))
    await until(() => all('session-column').length === 2)

    const filler = within(all('session-column')[1], 'pane-filler')[0]
    await until(() => within(filler, 'pane-filler-tab').length > 0)
    // The tab in front of the other pane is offered to move over.
    const fillerTab = within(filler, 'pane-filler-tab').find((el) => el.textContent?.includes('Add worktree switcher'))!
    await userEvent.click(fillerTab)
    await until(() => all('session-column')[1].textContent?.includes('Add worktree switcher') === true)
    expect(within(all('session-column')[0], 'session-tab')).toHaveLength(1)
  })

  it('a waiting pane opens a recent session, and its search narrows the list', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('window-layout-button'))
    await userEvent.click(page.getByTestId('layout-option-halves-h'))
    await until(() => all('session-column').length === 2)

    const filler = within(all('session-column')[1], 'pane-filler')[0]
    // Already open, so not offered as a session to open.
    expect(within(filler, 'pane-filler-session').filter((el) => el.textContent?.includes('Fix CSV export bug'))).toHaveLength(0)
    await userEvent.fill(within(filler, 'pane-filler-search')[0], 'repo root')
    await until(() => within(filler, 'pane-filler-session').length === 1)
    await userEvent.click(within(filler, 'pane-filler-session')[0])
    await until(() => all('session-column')[1].textContent?.includes('Repo root session') === true)
    expect(all('session-column')[1].getAttribute('data-placeholder')).toBe('false')
  })

  it('a filler does not offer a tab that is the only one in its pane, since moving it would empty the pane', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('window-layout-button'))
    await userEvent.click(page.getByTestId('layout-option-halves-h'))
    await until(() => all('session-column').length === 2)

    const filler = within(all('session-column')[1], 'pane-filler')[0]
    // Pane 1 has exactly one tab; moving it would empty pane 1, stepping the layout back down —
    // clicking it would appear to do nothing.
    expect(within(filler, 'pane-filler-tab').filter((el) => el.textContent?.includes('Fix CSV export bug'))).toHaveLength(0)

    // Give pane 1 a second tab: now moving either one leaves it non-empty, so both are safe to offer.
    await userEvent.click(sidebarSession('Add worktree switcher'))
    await until(() => within(filler, 'pane-filler-tab').filter((el) => el.textContent?.includes('Fix CSV export bug')).length === 1)
    expect(within(filler, 'pane-filler-tab').filter((el) => el.textContent?.includes('Add worktree switcher'))).toHaveLength(1)
  })

  it('a waiting pane can be closed, stepping the layout down', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('window-layout-button'))
    await userEvent.click(page.getByTestId('layout-option-grid'))
    await until(() => all('session-column').length === 4)
    await userEvent.click(within(all('session-column')[3], 'pane-filler-close')[0])
    await until(() => all('content')[0].getAttribute('data-preset') === 'main-right2')
    expect(all('session-column')).toHaveLength(3)
  })
})
