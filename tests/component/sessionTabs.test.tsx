import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { sidebarSession, clickRowAction, box, mouse, until } from './helpers'

/** Every element with a given data-testid, document-wide. */
function all(id: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)]
}
/** Every element with a given data-testid inside `root`. */
function within(root: Element, id: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)]
}
/** The real mouse, from the centre of `from` to (x, y) — enough movement for Chromium to read a
 * native HTML5 drag off a `draggable` element, the same way the divider drags do. */
async function dragTo(from: Element, x: number, y: number): Promise<void> {
  const r = from.getBoundingClientRect()
  await mouse.move(r.x + r.width / 2, r.y + r.height / 2)
  await mouse.down()
  await mouse.move(x, y, 8)
  await mouse.up()
}
function rightClick(el: Element): void {
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
}

describe('session tabs', () => {
  it('opening a second session adds a tab rather than replacing the first', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await until(() => all('session-tab').length === 1)

    await userEvent.click(sidebarSession('Add worktree switcher'))
    await until(() => all('session-tab').length === 2)
    await expect.element(page.getByTestId('session-title')).toHaveTextContent('Add worktree switcher')

    // Both remain open, and the first is one click away rather than needing to be reopened.
    await userEvent.click(all('session-tab-label')[0])
    await expect.element(page.getByTestId('session-title')).toHaveTextContent('Fix CSV export bug')
    expect(all('session-tab')).toHaveLength(2)
  })

  it('reopening an already-open session activates its tab instead of duplicating it', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(sidebarSession('Add worktree switcher'))
    await userEvent.click(sidebarSession('Fix CSV export bug'))

    await until(() => all('session-tab').length === 2)
    await expect.element(page.getByTestId('session-title')).toHaveTextContent('Fix CSV export bug')
  })

  it('closing a tab falls back to its neighbour, and closing the last one empties the column', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(sidebarSession('Add worktree switcher'))

    await userEvent.click(all('session-tab-close')[1])
    await until(() => all('session-tab').length === 1)
    await expect.element(page.getByTestId('session-title')).toHaveTextContent('Fix CSV export bug')

    await userEvent.click(all('session-tab-close')[0])
    await until(() => all('session-tab').length === 0)
    await expect.element(page.getByTestId('content-empty')).toBeVisible()
  })

  it('the split button opens the session in a second column, with its own shell', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await until(() => all('session-column').length === 1)

    await clickRowAction('Add worktree switcher', 'split-session-button')

    await until(() => all('session-column').length === 2)
    // One tab in each column, not two in one.
    expect(all('session-tab')).toHaveLength(2)
    // Each column carries its own shell toggle — a split gives you a second set of terminals, not
    // a second view onto one.
    expect(all('shell-toggle')).toHaveLength(2)

    const columns = all('session-column')
    expect(columns[0].textContent).toContain('Fix CSV export bug')
    expect(columns[1].textContent).toContain('Add worktree switcher')
  })

  it('splitting keeps adding panes up to four, then opens in an existing one', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    for (const title of ['Add worktree switcher', 'Repo root session', 'Worktree session']) {
      await clickRowAction(title, 'split-session-button')
    }
    await until(() => all('session-column').length === 4)
    expect(all('content')[0].getAttribute('data-preset')).toBe('grid')

    // A fifth has nowhere of its own to go.
    await userEvent.click(all('session-tab-split')[0])
    expect(all('session-column')).toHaveLength(4)
  })

  it('the shell pane stays pinned to the bottom instead of scrolling the layout away', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('shell-toggle'))
    await expect.element(page.getByTestId('terminal-shell')).toBeVisible()

    // The editor area must not become a scroll container: if it does, opening the shell pushes the
    // layout down and the pane scrolls out of view instead of docking, which is what used to happen.
    const overflow = getComputedStyle(all('content')[0]).overflowY
    expect(overflow).toBe('hidden')

    const windowHeight = window.innerHeight
    const pane = document.querySelector('.bottom-pane')!.getBoundingClientRect()
    // Docked means it ends where the layout does: one panel gap above the window's edge, the margin
    // every floating card keeps. Scrolled away, it would end below the edge or far above it.
    const panelGap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--panel-gap'))
    const gap = windowHeight - (pane.y + pane.height)
    expect(gap).toBeGreaterThanOrEqual(0)
    expect(gap).toBeLessThanOrEqual(panelGap + 1)
  })

  it('switching to a tab that never had a shell open spawns one automatically, not just an empty pane', async () => {
    // Regression: `shellOpen` lives at the column level, not per tab. Opening the shell for one
    // session and then switching to a different one (that has never had a shell of its own) used
    // to leave the pane rendering nothing at all — the pane was genuinely open, but no terminal
    // existed yet for the newly active tab, and nothing spawned one without an explicit
    // Hide-shell-then-Show-shell round trip.
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('shell-toggle'))
    await expect.element(page.getByTestId('terminal-shell')).toBeVisible()

    await userEvent.click(sidebarSession('Add worktree switcher'))
    // Same column, same still-open pane, a session that has never had a shell — a terminal must
    // appear on its own, without touching the shell toggle at all.
    await expect.element(page.getByTestId('terminal-shell')).toBeVisible()
    await expect.element(page.getByTestId('shell-toggle')).toHaveAttribute('title', 'Hide shell')
  })

  it('the tab bar splits the session it is already showing, without going back to the sidebar', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await until(() => all('session-column').length === 1)
    // No divider to drag while there is only one column.
    expect(all('column-resizer')).toHaveLength(0)

    await userEvent.click(page.getByTestId('session-tab-split'))

    await until(() => all('session-column').length === 2)
    expect(all('column-resizer')).toHaveLength(1)
    // Open in both, the way VS Code's split leaves the editor in the group it came from.
    const columns = all('session-column')
    expect(columns[0].textContent).toContain('Fix CSV export bug')
    expect(columns[1].textContent).toContain('Fix CSV export bug')
  })

  it('dragging the divider between two columns changes their widths', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('session-tab-split'))
    await until(() => all('session-column').length === 2)

    const widths = (): number[] => all('session-column').map((el) => Math.round(el.getBoundingClientRect().width))

    const [leftBefore, rightBefore] = widths()
    // A split starts even, which is what makes the drag below measurable.
    expect(Math.abs(leftBefore - rightBefore)).toBeLessThan(8)

    const handle = box(page.getByTestId('column-resizer'))
    await mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await mouse.down()
    await mouse.move(handle.x + handle.width / 2 + 200, handle.y + handle.height / 2, 10)
    await mouse.up()

    const [leftAfter, rightAfter] = widths()
    expect(leftAfter).toBeGreaterThan(leftBefore + 150)
    expect(rightAfter).toBeLessThan(rightBefore - 150)
    // The pair keeps the row's full width between them; dragging one boundary must not leave a gap.
    expect(Math.abs((leftAfter + rightAfter) - (leftBefore + rightBefore))).toBeLessThan(8)
  })

  it('a column cannot be dragged narrower than its floor', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('session-tab-split'))
    await until(() => all('session-column').length === 2)
    const handle = box(page.getByTestId('column-resizer'))

    // Drag far past the left edge of the window: the left column stops at its minimum instead of
    // collapsing to nothing (or going negative and taking the layout with it).
    await mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await mouse.down()
    await mouse.move(5, handle.y + handle.height / 2, 10)
    await mouse.up()

    const left = Math.round(all('session-column')[0].getBoundingClientRect().width)
    expect(left).toBeGreaterThanOrEqual(200)
  })

  it('a dialog opened from one column is not painted through by the next column', async () => {
    // Regression: `.modal-backdrop` carried no z-index. A modal is rendered inside whichever column
    // opened it, and later sibling columns contain positioned boxes of their own — so a dialog
    // opened from column 1 was painted over by column 2's transcript, which reads as the dialog
    // being translucent.
    await renderApp()
    await userEvent.click(sidebarSession('Repo root session'))
    await userEvent.click(page.getByTestId('session-tab-split'))
    await until(() => all('session-column').length === 2)

    await userEvent.click(within(all('session-column')[0], 'shell-toggle')[0])
    await expect.element(page.getByTestId('terminal-shell')).toBeVisible()
    await userEvent.click(all('toolbar-branch-button')[0])
    await expect.element(page.getByTestId('branch-switcher')).toBeVisible()

    // Whatever is actually painted over the dialog's own area must belong to the dialog. Sampled
    // near its right-hand edge, which is the part that overlaps the column to the right.
    const el = document.querySelector('[data-testid="branch-switcher"]') as HTMLElement
    const r = el.getBoundingClientRect()
    const owned = [0.25, 0.5, 0.75].map((f) => {
      const hit = document.elementFromPoint(r.right - 20, r.top + r.height * f)
      return el.contains(hit)
    })
    expect(owned).toEqual([true, true, true])
  })

  it('closing tabs never leaves an empty column stranded beside a full one', async () => {
    // The invariant behind "an empty side section appeared": a column with no tabs is dropped
    // unless it is the only one left, whichever route emptied it.
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(sidebarSession('Add worktree switcher'))
    // Each split adds a split button, so always act on the column that split last — the focused one.
    await until(() => all('session-tab-split').length === 1)
    await userEvent.click(all('session-tab-split')[all('session-tab-split').length - 1])
    await until(() => all('session-column').length === 2)
    await userEvent.click(sidebarSession('Repo root session'))
    await userEvent.click(all('session-tab-split')[all('session-tab-split').length - 1])
    await until(() => all('session-column').length === 3)

    const emptyColumns = (): number => all('session-column').filter((el) => within(el, 'session-tab').length === 0).length

    // Close tabs one at a time from every position, checking after each that no column has been
    // left behind without any.
    while (all('session-tab-close').length > 1) {
      const columns = all('session-column').length
      await userEvent.click(all('session-tab-close')[0])
      expect(emptyColumns()).toBe(0)
      expect(all('session-column').length).toBeLessThanOrEqual(columns)
    }

    // The very last one may leave a single empty column — that is the placeholder the next click
    // needs somewhere to land in, and it says so rather than being blank.
    await userEvent.click(all('session-tab-close')[0])
    await until(() => all('session-column').length === 1)
    await expect.element(page.getByTestId('content-empty')).toBeVisible()
  })

  it('a session already open in another column is focused there, not opened a second time', async () => {
    // Split puts the second session in a column of its own, so the two live in different columns.
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('session-tab-split'))
    await until(() => all('session-tab-bar').length === 2)

    await userEvent.click(sidebarSession('Add worktree switcher'))
    await userEvent.click(sidebarSession('Fix CSV export bug'))

    // Three tabs across two columns, not four: clicking a session that is already open goes to
    // where it is. A second copy would be the same conversation twice, indistinguishable from a split.
    await until(() => all('session-tab').length === 3)
    expect(all('session-tab')).toHaveLength(3)
  })

  it('a tab can be dragged to a new position, and stays where it is put', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(sidebarSession('Add worktree switcher'))
    await until(() => all('session-tab').length === 2)
    expect(all('session-tab')[0].textContent).toContain('Fix CSV export bug')

    const target = all('session-tab')[0].getBoundingClientRect()
    await dragTo(all('session-tab')[1], target.x + target.width / 2, target.y + target.height / 2)

    await until(() => all('session-tab')[0].textContent?.includes('Add worktree switcher') === true)
    expect(all('session-tab')[1].textContent).toContain('Fix CSV export bug')
    expect(all('session-tab')).toHaveLength(2)
  })

  it('right-clicking a tab offers to pin the session, which lifts it into the pinned section', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    expect(all('pinned-section')).toHaveLength(0)

    rightClick(all('session-tab')[0])
    await expect.element(page.getByTestId('tab-menu')).toBeVisible()
    await userEvent.click(page.getByTestId('context-menu-pin'))

    await expect.element(page.getByTestId('pinned-section')).toBeVisible()
    expect(within(all('pinned-section')[0], 'session-item')[0].textContent).toContain('Fix CSV export bug')

    // And the menu says so the second time round, rather than offering to pin it again.
    rightClick(all('session-tab')[0])
    await expect.element(page.getByTestId('context-menu-pin')).toHaveTextContent('Unpin from sidebar')
  })

  it('a tab dropped on the left edge of the first tab lands in first position', async () => {
    // The reported bug: dropping always landed *on* a tab, so "before the first one" was a position
    // no target corresponded to and dragging to the front appeared to do nothing.
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(sidebarSession('Add worktree switcher'))
    await until(() => all('session-tab').length === 2)
    expect(all('session-tab')[0].textContent).toContain('Fix CSV export bug')

    const target = all('session-tab')[0].getBoundingClientRect()
    await dragTo(all('session-tab')[1], target.x + 4, target.y + 10)

    await until(() => all('session-tab')[0].textContent?.includes('Add worktree switcher') === true)
    expect(all('session-tab')).toHaveLength(2)
  })

  // The reported bug: the tab being dragged belonged to another column, and a strip that reacted
  // only to a drag begun inside itself never became a drop target at all — so the drag ended with
  // the tab snapping back and nothing having happened.
  it('a tab can be dragged from one column into another, at the position it is dropped', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('session-tab-split'))
    await until(() => all('session-column').length === 2)

    // The second column gets a session of its own, which is the one to drag across.
    await userEvent.click(sidebarSession('Add worktree switcher'))
    await until(() => within(all('session-column')[1], 'session-tab').length === 2)

    const dragged = within(all('session-column')[1], 'session-tab')
      .find((el) => el.textContent?.includes('Add worktree switcher'))!
    const targetTab = within(all('session-column')[0], 'session-tab')[0]
    const targetBox = targetTab.getBoundingClientRect()
    await dragTo(dragged, targetBox.x + 4, targetBox.y + 10)

    await until(() => within(all('session-column')[0], 'session-tab').length === 2)
    const left = within(all('session-column')[0], 'session-tab')
    expect(left[0].textContent).toContain('Add worktree switcher')
    // And it has left the column it came from, rather than being open twice.
    expect(within(all('session-column')[1], 'session-tab')).toHaveLength(1)
  })

  it('dragging a column its last tab leaves that column gone, not empty', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('session-tab-split'))
    await until(() => all('session-column').length === 2)
    await userEvent.click(sidebarSession('Add worktree switcher'))
    await until(() => within(all('session-column')[1], 'session-tab').length === 2)

    const fixTab = within(all('session-column')[1], 'session-tab')
      .find((el) => el.textContent?.includes('Fix CSV export bug'))!
    await userEvent.click(fixTab.querySelector('[data-testid="session-tab-close"]')!)
    await until(() => within(all('session-column')[1], 'session-tab').length === 1)

    const remaining = within(all('session-column')[1], 'session-tab')[0]
    const targetBox = within(all('session-column')[0], 'session-tab')[0].getBoundingClientRect()
    await dragTo(remaining, targetBox.x + 4, targetBox.y + 10)

    await until(() => all('session-column').length === 1)
    expect(all('session-tab')).toHaveLength(2)
  })

  it('every tab shows its close button without being hovered first', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(sidebarSession('Add worktree switcher'))
    await until(() => all('session-tab').length === 2)

    // Including the inactive one, which is the case that used to leave the right-click menu as the
    // only way to close a tab at all.
    const inactive = all('session-tab')[0]
    expect(inactive.getAttribute('data-active')).toBe('false')
    const closeButton = within(inactive, 'session-tab-close')[0]
    await expect.element(page.elementLocator(closeButton)).toBeVisible()
    expect(getComputedStyle(closeButton).opacity).toBe('1')

    await userEvent.click(closeButton)
    await until(() => all('session-tab').length === 1)
  })

  // The reported bug, and the gesture that produces it: split, drag the divider, close the second
  // column. The survivor kept the growth factor the drag gave it (below 1), and flex hands out only
  // that fraction of the row — so the rest stayed as an empty panel beside the session.
  it('closing a column after dragging the divider leaves no empty strip beside the survivor', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('session-tab-split'))
    await until(() => all('session-column').length === 2)

    // Drag left, so the *first* column ends up with the smaller weight and is the one left behind.
    const handle = box(page.getByTestId('column-resizer'))
    await mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await mouse.down()
    await mouse.move(handle.x - 200, handle.y + handle.height / 2, 10)
    await mouse.up()

    await userEvent.click(within(all('session-column')[1], 'session-tab-close')[0])
    await until(() => all('session-column').length === 1)

    const content = all('content')[0].getBoundingClientRect()
    const column = all('session-column')[0].getBoundingClientRect()
    // The one remaining column fills the row it is in, rather than stopping partway across it.
    expect(column.width).toBeGreaterThan(content.width - 2)
  })

  // The follow-up report: making the close button always *painted* was not enough, because with
  // enough tabs open the last one was sliced through by the edge of the strip and its close button
  // was outside the visible area — no scrollbar, no way to reach it but the right-click menu.
  it('the close button stays reachable as tabs multiply and the strip runs out of room', async () => {
    // Narrow the room first, then fill it: three columns makes each strip small enough that four
    // tabs cannot possibly keep their full width.
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('session-tab-split'))
    await until(() => all('session-column').length === 2)
    await userEvent.click(all('session-tab-split')[0])
    await until(() => all('session-column').length === 3)

    const column = all('session-column')[0]
    for (const title of ['Add worktree switcher', 'Repo root session', 'Worktree session']) {
      await userEvent.click(within(column, 'session-tab')[0])
      await userEvent.click(sidebarSession(title))
    }
    await until(() => within(column, 'session-tab').length === 4)

    // The tabs give up width rather than running off the end: every close button is inside the
    // strip, and every tab is narrower than it would have been left to itself.
    const strip = column.querySelector('.session-tab-strip')!.getBoundingClientRect()
    const tabs = within(column, 'session-tab')
    for (const tab of tabs) {
      const box_ = tab.getBoundingClientRect()
      expect(box_.width).toBeLessThan(220)
      const close = within(tab, 'session-tab-close')[0].getBoundingClientRect()
      expect(close.width).toBeGreaterThan(0)
      expect(close.x).toBeGreaterThanOrEqual(strip.x - 1)
      expect(close.x + close.width).toBeLessThanOrEqual(strip.x + strip.width + 1)
    }
  })

  // Past the point where shrinking can help, the strip scrolls — and then the tab being worked in
  // has to be the one on screen, or switching to a tab leaves you looking at a sliver of it.
  it('the active tab is scrolled into view when there are more tabs than fit', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('session-tab-split'))
    await until(() => all('session-column').length === 2)
    await userEvent.click(all('session-tab-split')[0])
    await until(() => all('session-column').length === 3)

    const column = all('session-column')[0]
    for (const title of ['Add worktree switcher', 'Repo root session', 'Worktree session']) {
      await userEvent.click(within(column, 'session-tab')[0])
      await userEvent.click(sidebarSession(title))
    }
    await until(() => within(column, 'session-tab').length === 4)

    const strip = column.querySelector('.session-tab-strip')!.getBoundingClientRect()
    const active = column.querySelector('[data-testid="session-tab"][data-active="true"]')!.getBoundingClientRect()
    expect(active.x).toBeGreaterThanOrEqual(strip.x - 1)
    expect(active.x + active.width).toBeLessThanOrEqual(strip.x + strip.width + 1)
  })

  it('with one pane there is nothing to swap with, so its tab bar does not drag', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await expect.element(page.getByTestId('session-tab-strip')).toHaveAttribute('draggable', 'false')
  })
})
