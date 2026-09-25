import { test, expect, type Page, type Locator } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApiary, importAll, relaunchApiary, type Harness, sidebarSession } from './helpers'
import { makeSession } from '../fixtures/makeSession'

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
  await expect(sidebarSession(h.page, 'Fix CSV export bug')).toBeVisible()

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
  await expect(sidebarSession(h.page, 'Fix CSV export bug')).toBeVisible()
  await expect(sidebarSession(h.page, 'Add worktree switcher')).toBeVisible()
  await expect(sidebarSession(h.page, 'Repo root session')).toHaveCount(0)
  await expect(sidebarSession(h.page, 'Worktree session')).toHaveCount(0)
})

test('selecting a session marks it selected and shows its header', async () => {
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await sidebarSession(h.page, 'Fix CSV export bug').click()
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
  await expect(sidebarSession(h.page, 'Fix CSV export bug')).toBeVisible()
  await expect(sidebarSession(h.page, 'Add worktree switcher')).toBeVisible()
  await expect(sidebarSession(h.page, 'Repo root session')).toHaveCount(0)
})

test('the selected session is restored after a relaunch (Finding 1b)', async () => {
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await sidebarSession(h.page, 'Fix CSV export bug').click()
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

test('a session worked in recently appears in Recent, and dismissing it hides it until reused', async () => {
  // Every standard fixture session is timestamped in 2026-09 (see makeSession), which is not
  // "recent" relative to whenever this suite actually runs. A session is written here whose
  // last line is patched to a live timestamp, so it lands inside the default 24-hour Recent
  // window no matter what today's real date is.
  const sessionId = '99999999-9999-9999-9999-999999999999'
  makeSession(h.projectsRoot, '-work-a-recent', {
    sessionId,
    cwd: h.workdir,
    title: 'Recently active session',
  })
  const file = join(h.projectsRoot, '-work-a-recent', `${sessionId}.jsonl`)
  const patched = readFileSync(file, 'utf8').replace('2026-09-02T12:00:00.000Z', new Date().toISOString())
  writeFileSync(file, patched)

  // `importAll` marks whatever the store already knows about as imported; a file written to disk
  // after launch is not in the store yet, so a rescan has to complete first. The Refresh button's
  // click resolves as soon as the event is dispatched, not once its async rescan finishes, so the
  // rescan's own effect (a 5th discovered session) is polled for rather than assumed.
  await h.page.getByTestId('sidebar-refresh').click()
  await expect.poll(
    () => h.page.evaluate(() => window.apiary.discovered()).then((d) => d.length),
    { timeout: 10000 },
  ).toBe(5)
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  // 5 imported sessions in the tree, plus the new one a second time in the Recent section below it.
  await expect(h.page.getByTestId('session-item')).toHaveCount(6, { timeout: 15000 })

  const section = h.page.getByTestId('recent-section')
  await expect(section).toBeVisible()
  await expect(section.getByTestId('session-item')).toContainText('Recently active session')

  const row = section.locator('.recent-row-wrap').filter({ hasText: 'Recently active session' })
  // Hidden until the row is hovered, the same way the pin/split/remove actions are: shown always,
  // it sat as a bare block on top of the session's timestamp.
  await expect(row.getByTestId('recent-dismiss-button')).toBeHidden()
  await row.hover()
  const dismiss = row.getByTestId('recent-dismiss-button')
  await expect(dismiss).toBeVisible()
  // And it has an icon in it. An inline <svg> with no width/height collapses inside a flex button,
  // which is what turned this into an empty grey box.
  const iconBox = await dismiss.locator('svg').boundingBox()
  expect(iconBox?.width ?? 0).toBeGreaterThan(0)
  expect(iconBox?.height ?? 0).toBeGreaterThan(0)

  // One of the row's own actions, not a control laid over them: reported as a large X sitting on
  // top of the layout button. Same size as its neighbours, and overlapping none of them.
  const split = row.getByTestId('split-session-button')
  const d = await dismiss.boundingBox()
  const b = await split.boundingBox()
  if (d === null || b === null) throw new Error('dismiss or layout button has no box')
  expect(Math.round(d.height)).toBe(Math.round(b.height))
  expect(Math.round(d.width)).toBe(Math.round(b.width))
  const overlap = d.x < b.x + b.width && d.x + d.width > b.x && d.y < b.y + b.height && d.y + d.height > b.y
  expect(overlap).toBe(false)

  await dismiss.click()
  await expect(section.getByTestId('session-item')).toHaveCount(0)
})

test('the Recent window is a validated setting', async () => {
  // The menu lives in the main process; trigger the same channel it sends rather than reaching
  // for a renderer menu button that does not exist.
  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog')
  })
  await expect(h.page.getByTestId('settings-dialog')).toBeVisible()
  await h.page.getByTestId('settings-nav-sidebar').click()

  await h.page.getByTestId('setting-recent-hours').fill('9999')
  await h.page.getByTestId('setting-recent-hours').blur()
  await expect(h.page.getByTestId('setting-recent-hours')).toHaveValue('168')
})

test('a folder holding the open session can still be collapsed', async () => {
  // With "Reveal the open session in the sidebar" on, the reveal effect opens whatever folders
  // stand between the top of the tree and the active session. It re-runs whenever `collapsed`
  // changes — which is exactly what a click on the chevron does — so unless its latch has already
  // caught, the user's collapse is undone in the same tick that requested it. The folder flickers
  // shut and springs back open, and no amount of clicking helps.
  //
  // Opening the session first is the whole point: collapsing a folder that holds nothing open has
  // never been broken.
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await expect(h.page.getByTestId('session-item')).toHaveCount(4)

  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')

  await h.page.getByTestId('project-toggle').first().click()

  // It must still be collapsed a moment later, not merely at the instant of the click: the
  // re-expand arrives on the next render, so an immediate assertion would pass against the bug.
  await expect(h.page.getByTestId('session-item')).toHaveCount(2)
  // eslint-disable-next-line playwright/no-wait-for-timeout -- proving it stays collapsed rather than re-expanding a moment later; there is no later condition to assert on other than re-checking after time passes
  await h.page.waitForTimeout(300)
  await expect(h.page.getByTestId('session-item')).toHaveCount(2)
})
