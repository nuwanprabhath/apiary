import { test, expect, type Page, type Locator } from '@playwright/test'
import { launchApiary, importAll, relaunchApiary, type Harness } from './helpers'

let h: Harness
test.beforeEach(async () => { h = await launchApiary() })
test.afterEach(async () => { await h.close() })

/**
 * The project-group `<li>` whose OWN toggle button (a direct child, not one belonging to a
 * nested worktree group further down the same subtree) carries exactly this label. Using the
 * `> button` direct-child combinator is what keeps this from also matching an ancestor group
 * that merely contains the target group somewhere in its nested subtree.
 */
function groupLabelled(page: Page, label: string): Locator {
  return page.locator(
    `li[data-testid="project-group"]:has(> div > button[data-testid="project-toggle"] .project-label:text-is("${label}"))`,
  )
}

test('shows an empty state before anything is imported', async () => {
  await expect(h.page.getByTestId('sidebar-empty')).toBeVisible()
})

test('lists imported sessions grouped under their own folder, including worktree nesting', async () => {
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()

  // Structure, not counts: each session must live inside its own project group's subtree,
  // not merely appear somewhere on the page. A flattened list would fail every assertion below
  // because none of these scoped locators would resolve.
  const workA = groupLabelled(h.page, 'work-a')
  const workB = groupLabelled(h.page, 'work-b')
  const repoC = groupLabelled(h.page, 'repo-c')
  const repoCWt = groupLabelled(h.page, 'repo-c-wt')

  await expect(workA.getByTestId('session-item')).toHaveCount(1)
  await expect(workA.getByText('Fix CSV export bug')).toBeVisible()

  await expect(workB.getByTestId('session-item')).toHaveCount(1)
  await expect(workB.getByText('Add worktree switcher')).toBeVisible()

  // repo-c's own subtree includes its own session and the nested worktree's session (the
  // worktree group is nested inside it in the DOM); scoped to just repo-c's own row it must
  // show only its own session.
  await expect(repoC.getByText('Repo root session')).toBeVisible()

  // The worktree group must be nested *inside* the parent repo group in the DOM tree — this is
  // the feature the user specifically asked for (repo -> worktree -> session nesting).
  await expect(repoC.locator(`li[data-testid="project-group"]:has(> div > button .project-label:text-is("repo-c-wt"))`)).toHaveCount(1)
  await expect(repoCWt.getByTestId('session-item')).toHaveCount(1)
  await expect(repoCWt.getByText('Worktree session')).toBeVisible()

  // repo-c's own session count, scoped narrowly enough to exclude the nested worktree group's
  // session, must be exactly 1 — proving the worktree session is attached under its own nested
  // group rather than flattened onto the parent.
  const repoCOwnSessions = h.page.locator(
    'li[data-testid="project-group"]:has(> div > button .project-label:text-is("repo-c")) > div.session-row-wrap > button[data-testid="session-item"]',
  )
  await expect(repoCOwnSessions).toHaveCount(1)

  await expect(h.page.getByTestId('session-item')).toHaveCount(4)
})

test('filters sessions by title as you type', async () => {
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await expect(h.page.getByTestId('session-item')).toHaveCount(4)

  await h.page.getByTestId('search-input').fill('csv')
  await expect(h.page.getByTestId('session-item')).toHaveCount(1)
  await expect(h.page.getByText('Fix CSV export bug')).toBeVisible()

  await h.page.getByTestId('search-input').fill('')
  await expect(h.page.getByTestId('session-item')).toHaveCount(4)
})

test('collapsing a folder hides only that folder (and its nested worktree), not every folder', async () => {
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await expect(h.page.getByTestId('session-item')).toHaveCount(4)

  // Top-level groups sort alphabetically by label: repo-c, work-a, work-b — so the first
  // top-level toggle belongs to repo-c, which (via its nested worktree) owns 2 of the 4
  // sessions. A defect that collapsed every folder unconditionally would drop the count to 0;
  // the correct, folder-scoped behaviour drops it to exactly 2 (work-a's and work-b's own
  // sessions untouched).
  await h.page.getByTestId('project-toggle').first().click()
  await expect(h.page.getByTestId('session-item')).toHaveCount(2)
  await expect(h.page.getByText('Fix CSV export bug')).toBeVisible()
  await expect(h.page.getByText('Add worktree switcher')).toBeVisible()
  await expect(h.page.getByText('Repo root session')).toHaveCount(0)
  await expect(h.page.getByText('Worktree session')).toHaveCount(0)
})

test('selecting a session marks it selected and shows its header', async () => {
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await h.page.getByText('Fix CSV export bug').click()
  await expect(h.page.getByTestId('session-item').filter({ hasText: 'Fix CSV export bug' }))
    .toHaveAttribute('data-selected', 'true')
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')
})

test('a folder collapsed by the user stays collapsed after a relaunch (Finding 1a)', async () => {
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await expect(h.page.getByTestId('session-item')).toHaveCount(4)

  // Top-level groups sort alphabetically: repo-c, work-a, work-b. Collapsing the first toggle
  // (repo-c, which owns 2 of the 4 sessions via itself and its nested worktree) drops the
  // visible count to 2 — see the "collapsing a folder" test above for why that count is exact.
  await h.page.getByTestId('project-toggle').first().click()
  await expect(h.page.getByTestId('session-item')).toHaveCount(2)

  await relaunchApiary(h)

  // A stale re-expand bug would put every session back; the fix keeps repo-c collapsed while
  // everything else (including any folder discovered fresh on this relaunch) opens by default.
  await expect(h.page.getByTestId('session-item')).toHaveCount(2)
  await expect(h.page.getByText('Fix CSV export bug')).toBeVisible()
  await expect(h.page.getByText('Add worktree switcher')).toBeVisible()
  await expect(h.page.getByText('Repo root session')).toHaveCount(0)
})

test('the selected session is restored after a relaunch (Finding 1b)', async () => {
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await h.page.getByText('Fix CSV export bug').click()
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')

  await relaunchApiary(h)

  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')
  await expect(h.page.getByTestId('session-item').filter({ hasText: 'Fix CSV export bug' }))
    .toHaveAttribute('data-selected', 'true')
})

test('dragging the sidebar resizer persists the new width across a relaunch (Finding 1c)', async () => {
  const sidebar = h.page.locator('.sidebar')
  const before = await sidebar.boundingBox()
  if (before === null) throw new Error('sidebar has no bounding box')

  const resizer = h.page.getByTestId('sidebar-resizer')
  const box = await resizer.boundingBox()
  if (box === null) throw new Error('resizer has no bounding box')
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2

  await h.page.mouse.move(startX, startY)
  await h.page.mouse.down()
  await h.page.mouse.move(startX + 150, startY, { steps: 8 })
  await h.page.mouse.up()

  const dragged = await sidebar.boundingBox()
  if (dragged === null) throw new Error('sidebar has no bounding box after drag')
  expect(dragged.width).toBeGreaterThan(before.width + 100)

  await relaunchApiary(h)

  const afterRelaunch = await h.page.locator('.sidebar').boundingBox()
  if (afterRelaunch === null) throw new Error('sidebar has no bounding box after relaunch')
  expect(Math.abs(afterRelaunch.width - dragged.width)).toBeLessThanOrEqual(2)
})
