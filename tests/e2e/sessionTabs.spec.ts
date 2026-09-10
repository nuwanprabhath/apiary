import { test, expect } from '@playwright/test'
import { launchApiary, importAll, sidebarSession, type Harness, rowAction } from './helpers'

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
  await (await rowAction(splitRow, 'split-session-button')).click()

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
    await (await rowAction(target, 'split-session-button')).click()
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
