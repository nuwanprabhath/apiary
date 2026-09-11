import { test, expect } from '@playwright/test'
import { launchApiary, importAll, sidebarSession, type Harness, clickRowAction } from './helpers'

let h: Harness
test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})
test.afterEach(async () => { await h.close() })

test('opening a second session adds a tab rather than replacing the first', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await expect(h.page.getByTestId('session-tab')).toHaveCount(1)

  await sidebarSession(h.page, 'Add worktree switcher').click()
  await expect(h.page.getByTestId('session-tab')).toHaveCount(2)
  await expect(h.page.getByTestId('session-title')).toHaveText('Add worktree switcher')

  // Both remain open, and the first is one click away rather than needing to be reopened.
  await h.page.getByTestId('session-tab').first().getByTestId('session-tab-label').click()
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')
  await expect(h.page.getByTestId('session-tab')).toHaveCount(2)
})

test('reopening an already-open session activates its tab instead of duplicating it', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await sidebarSession(h.page, 'Add worktree switcher').click()
  await sidebarSession(h.page, 'Fix CSV export bug').click()

  await expect(h.page.getByTestId('session-tab')).toHaveCount(2)
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')
})

test('closing a tab falls back to its neighbour, and closing the last one empties the column', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await sidebarSession(h.page, 'Add worktree switcher').click()

  await h.page.getByTestId('session-tab').last().getByTestId('session-tab-close').click()
  await expect(h.page.getByTestId('session-tab')).toHaveCount(1)
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')

  await h.page.getByTestId('session-tab').first().getByTestId('session-tab-close').click()
  await expect(h.page.getByTestId('session-tab')).toHaveCount(0)
  await expect(h.page.getByTestId('content-empty')).toBeVisible()
})

test('the split button opens the session in a second column, with its own shell', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await expect(h.page.getByTestId('session-column')).toHaveCount(1)

  // The split button is a sibling of the row button, not a child of it (a <button> can't nest
  // another), so filter the wrapper rather than the row.
  const splitRow = h.page.locator('.session-row-wrap').filter({ hasText: 'Add worktree switcher' })
  await clickRowAction(splitRow, 'split-session-button')

  await expect(h.page.getByTestId('session-column')).toHaveCount(2)
  // One tab in each column, not two in one.
  await expect(h.page.getByTestId('session-tab')).toHaveCount(2)

  // Each column carries its own shell toggle — a split gives you a second set of terminals, not
  // a second view onto one.
  await expect(h.page.getByTestId('shell-toggle')).toHaveCount(2)

  const columns = h.page.getByTestId('session-column')
  await expect(columns.first()).toContainText('Fix CSV export bug')
  await expect(columns.last()).toContainText('Add worktree switcher')
})

test('splitting again keeps adding columns — there is no cap', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  for (const title of ['Add worktree switcher', 'Repo root session']) {
    const target = h.page.locator('.session-row-wrap').filter({ hasText: title })
    await clickRowAction(target, 'split-session-button')
  }
  await expect(h.page.getByTestId('session-column')).toHaveCount(3)
})

test('the shell pane stays pinned to the bottom instead of scrolling the layout away', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()

  // The editor area must not become a scroll container: if it does, opening the shell pushes the
  // layout down and the pane scrolls out of view instead of docking, which is what used to happen.
  const overflow = await h.page.getByTestId('content')
    .evaluate((el) => getComputedStyle(el).overflowY)
  expect(overflow).toBe('hidden')

  const viewport = h.page.viewportSize()
  const pane = await h.page.locator('.bottom-pane').boundingBox()
  expect(pane).not.toBeNull()
  if (pane !== null && viewport !== null) {
    expect(Math.abs(viewport.height - (pane.y + pane.height))).toBeLessThan(4)
  }
})

test('switching to a tab that never had a shell open spawns one automatically, not just an empty pane', async () => {
  // Regression: `shellOpen` lives at the column level, not per tab. Opening the shell for one
  // session and then switching to a different one (that has never had a shell of its own) used
  // to leave the pane rendering nothing at all — the pane was genuinely open, but no terminal
  // existed yet for the newly active tab, and nothing spawned one without an explicit
  // Hide-shell-then-Show-shell round trip.
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()

  await sidebarSession(h.page, 'Add worktree switcher').click()
  // Same column, same still-open pane, a session that has never had a shell — a terminal must
  // appear on its own, without touching the shell toggle at all.
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible({ timeout: 10000 })
  await expect(h.page.getByTestId('shell-toggle')).toHaveAttribute('title', 'Hide shell')
})

test('the bottom pane shrinks to fit a short window instead of overflowing off the bottom', async () => {
  // Regression: .bottom-pane used to be a rigid (`flex: none`) fixed-height box. On a window too
  // short to fit the tab bar, header and the shell pane's full requested height, the pane simply
  // ran past the bottom of the column, and `.session-column`'s `overflow: hidden` clipped
  // whatever fell off the edge — the last line or two of a terminal, or the tail of a dropdown.
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()

  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1000, 420)
  })
  await h.page.waitForTimeout(300)

  const viewportHeight = await h.page.evaluate(() => window.innerHeight)
  const pane = await h.page.locator('.bottom-pane').boundingBox()
  expect(pane).not.toBeNull()
  if (pane !== null) {
    // The pane's bottom edge must land at (or above) the window's own bottom edge — never past it.
    expect(pane.y + pane.height).toBeLessThanOrEqual(viewportHeight + 1)
  }
  // The toolbar (and its Hide/Show shell button) must still be reachable even when squeezed.
  await expect(h.page.getByTestId('shell-toggle')).toBeVisible()
})

test('the tab bar splits the session it is already showing, without going back to the sidebar', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await expect(h.page.getByTestId('session-column')).toHaveCount(1)
  // No divider to drag while there is only one column.
  await expect(h.page.getByTestId('column-resizer')).toHaveCount(0)

  await h.page.getByTestId('session-tab-split').click()

  await expect(h.page.getByTestId('session-column')).toHaveCount(2)
  await expect(h.page.getByTestId('column-resizer')).toHaveCount(1)
  // Open in both, the way VS Code's split leaves the editor in the group it came from.
  const columns = h.page.getByTestId('session-column')
  await expect(columns.first()).toContainText('Fix CSV export bug')
  await expect(columns.last()).toContainText('Fix CSV export bug')
})

test('dragging the divider between two columns changes their widths', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('session-tab-split').click()
  await expect(h.page.getByTestId('session-column')).toHaveCount(2)

  const widths = async (): Promise<number[]> =>
    h.page.getByTestId('session-column').evaluateAll(
      (els) => els.map((el) => Math.round(el.getBoundingClientRect().width)),
    )

  const [leftBefore, rightBefore] = await widths()
  // A split starts even, which is what makes the drag below measurable.
  expect(Math.abs(leftBefore - rightBefore)).toBeLessThan(8)

  const handle = (await h.page.getByTestId('column-resizer').boundingBox())!
  await h.page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await h.page.mouse.down()
  await h.page.mouse.move(handle.x + handle.width / 2 + 200, handle.y + handle.height / 2, { steps: 10 })
  await h.page.mouse.up()

  const [leftAfter, rightAfter] = await widths()
  expect(leftAfter).toBeGreaterThan(leftBefore + 150)
  expect(rightAfter).toBeLessThan(rightBefore - 150)
  // The pair keeps the row's full width between them; dragging one boundary must not leave a gap.
  expect(Math.abs((leftAfter + rightAfter) - (leftBefore + rightBefore))).toBeLessThan(8)
})

test('a column cannot be dragged narrower than its floor', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('session-tab-split').click()
  const handle = (await h.page.getByTestId('column-resizer').boundingBox())!

  // Drag far past the left edge of the window: the left column stops at its minimum instead of
  // collapsing to nothing (or going negative and taking the layout with it).
  await h.page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await h.page.mouse.down()
  await h.page.mouse.move(5, handle.y + handle.height / 2, { steps: 10 })
  await h.page.mouse.up()

  const [left] = await h.page.getByTestId('session-column').evaluateAll(
    (els) => els.map((el) => Math.round(el.getBoundingClientRect().width)),
  )
  expect(left).toBeGreaterThanOrEqual(200)
})

test('a dialog opened from one column is not painted through by the next column', async () => {
  // Regression: `.modal-backdrop` carried no z-index. A modal is rendered inside whichever column
  // opened it, and later sibling columns contain positioned boxes of their own — so a dialog
  // opened from column 1 was painted over by column 2's transcript, which reads as the dialog
  // being translucent.
  await sidebarSession(h.page, 'Repo root session').click()
  await h.page.getByTestId('session-tab-split').click()
  await expect(h.page.getByTestId('session-column')).toHaveCount(2)

  await h.page.getByTestId('session-column').first().getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell').first()).toBeVisible()
  await h.page.getByTestId('toolbar-branch-button').first().click()
  await expect(h.page.getByTestId('branch-switcher')).toBeVisible()

  // Whatever is actually painted over the dialog's own area must belong to the dialog. Sampled
  // near its right-hand edge, which is the part that overlaps the column to the right.
  const owned = await h.page.evaluate(() => {
    const el = document.querySelector('[data-testid="branch-switcher"]') as HTMLElement
    const r = el.getBoundingClientRect()
    return [0.25, 0.5, 0.75].map((f) => {
      const hit = document.elementFromPoint(r.right - 20, r.top + r.height * f)
      return el.contains(hit)
    })
  })
  expect(owned).toEqual([true, true, true])
})

test('closing tabs never leaves an empty column stranded beside a full one', async () => {
  // The invariant behind "an empty side section appeared": a column with no tabs is dropped
  // unless it is the only one left, whichever route emptied it.
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await sidebarSession(h.page, 'Add worktree switcher').click()
  // Each split adds a split button, so always act on the column that split last — the focused one.
  await h.page.getByTestId('session-tab-split').last().click()
  await sidebarSession(h.page, 'Repo root session').click()
  await h.page.getByTestId('session-tab-split').last().click()
  await expect(h.page.getByTestId('session-column')).toHaveCount(3)

  const emptyColumns = async (): Promise<number> =>
    h.page.getByTestId('session-column').evaluateAll(
      (els) => els.filter((el) => el.querySelectorAll('[data-testid="session-tab"]').length === 0).length,
    )

  // Close tabs one at a time from every position, checking after each that no column has been
  // left behind without any.
  while (await h.page.getByTestId('session-tab-close').count() > 1) {
    const columns = await h.page.getByTestId('session-column').count()
    await h.page.getByTestId('session-tab-close').first().click()
    expect(await emptyColumns()).toBe(0)
    expect(await h.page.getByTestId('session-column').count()).toBeLessThanOrEqual(columns)
  }

  // The very last one may leave a single empty column — that is the placeholder the next click
  // needs somewhere to land in, and it says so rather than being blank.
  await h.page.getByTestId('session-tab-close').first().click()
  await expect(h.page.getByTestId('session-column')).toHaveCount(1)
  await expect(h.page.getByTestId('content-empty')).toBeVisible()
})

test('a session already open in another column is focused there, not opened a second time', async () => {
  // Split puts the second session in a column of its own, so the two live in different columns.
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('session-tab-split').click()
  await expect(h.page.getByTestId('session-tab-bar')).toHaveCount(2)

  await sidebarSession(h.page, 'Add worktree switcher').click()
  await sidebarSession(h.page, 'Fix CSV export bug').click()

  // Three tabs across two columns, not four: clicking a session that is already open goes to
  // where it is. A second copy would be the same conversation twice, indistinguishable from a split.
  await expect(h.page.getByTestId('session-tab')).toHaveCount(3)
})

test('a tab can be dragged to a new position, and stays where it is put', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await sidebarSession(h.page, 'Add worktree switcher').click()
  const tabs = h.page.getByTestId('session-tab')
  await expect(tabs.first()).toContainText('Fix CSV export bug')

  await tabs.last().dragTo(tabs.first())

  await expect(tabs.first()).toContainText('Add worktree switcher')
  await expect(tabs.last()).toContainText('Fix CSV export bug')
  await expect(tabs).toHaveCount(2)
})

test('right-clicking a tab offers to pin the session, which lifts it into the pinned section', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await expect(h.page.getByTestId('pinned-section')).toHaveCount(0)

  await h.page.getByTestId('session-tab').first().click({ button: 'right' })
  await expect(h.page.getByTestId('tab-menu')).toBeVisible()
  await h.page.getByTestId('context-menu-pin').click()

  const section = h.page.getByTestId('pinned-section')
  await expect(section).toBeVisible()
  await expect(section.getByTestId('session-item')).toContainText('Fix CSV export bug')

  // And the menu says so the second time round, rather than offering to pin it again.
  await h.page.getByTestId('session-tab').first().click({ button: 'right' })
  await expect(h.page.getByTestId('context-menu-pin')).toHaveText('Unpin from sidebar')
})

test('a tab dropped on the left edge of the first tab lands in first position', async () => {
  // The reported bug: dropping always landed *on* a tab, so "before the first one" was a position
  // no target corresponded to and dragging to the front appeared to do nothing.
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await sidebarSession(h.page, 'Add worktree switcher').click()
  const tabs = h.page.getByTestId('session-tab')
  await expect(tabs.first()).toContainText('Fix CSV export bug')

  await tabs.last().dragTo(tabs.first(), { targetPosition: { x: 4, y: 10 } })

  await expect(tabs.first()).toContainText('Add worktree switcher')
  await expect(tabs).toHaveCount(2)
})

// The reported bug: the tab being dragged belonged to another column, and a strip that reacted
// only to a drag begun inside itself never became a drop target at all — so the drag ended with
// the tab snapping back and nothing having happened.
test('a tab can be dragged from one column into another, at the position it is dropped', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('session-tab-split').click()
  await expect(h.page.getByTestId('session-column')).toHaveCount(2)

  // The second column gets a session of its own, which is the one to drag across.
  await sidebarSession(h.page, 'Add worktree switcher').click()
  const columns = h.page.getByTestId('session-column')
  await expect(columns.last().getByTestId('session-tab')).toHaveCount(2)

  const dragged = columns.last().getByTestId('session-tab')
    .filter({ hasText: 'Add worktree switcher' })
  await dragged.dragTo(columns.first().getByTestId('session-tab').first(), {
    targetPosition: { x: 4, y: 10 },
  })

  const left = columns.first().getByTestId('session-tab')
  await expect(left).toHaveCount(2)
  await expect(left.first()).toContainText('Add worktree switcher')
  // And it has left the column it came from, rather than being open twice.
  await expect(columns.last().getByTestId('session-tab')).toHaveCount(1)
})

test('dragging a column its last tab leaves that column gone, not empty', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('session-tab-split').click()
  await sidebarSession(h.page, 'Add worktree switcher').click()
  const columns = h.page.getByTestId('session-column')
  await columns.last().getByTestId('session-tab').filter({ hasText: 'Fix CSV export bug' })
    .getByTestId('session-tab-close').click()
  await expect(columns.last().getByTestId('session-tab')).toHaveCount(1)

  await columns.last().getByTestId('session-tab').first()
    .dragTo(columns.first().getByTestId('session-tab').first(), { targetPosition: { x: 4, y: 10 } })

  await expect(h.page.getByTestId('session-column')).toHaveCount(1)
  await expect(h.page.getByTestId('session-tab')).toHaveCount(2)
})
