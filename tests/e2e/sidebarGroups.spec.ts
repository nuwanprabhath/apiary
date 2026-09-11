import { test, expect, type Locator, type Page } from '@playwright/test'
import { launchApiary, importAll, relaunchApiary, type Harness } from './helpers'

let h: Harness
test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})
test.afterEach(async () => { await h.close() })

/** A top-level folder row, addressed by the label on its own toggle. */
function folder(page: Page, label: string): Locator {
  return page.locator(
    `div.project-row-wrap[data-depth="0"]:has(> button[data-testid="project-toggle"] .project-label:text-is("${label}"))`,
  )
}

/**
 * The labels of the top-level folders, in the order they are drawn.
 *
 * Waits for at least one before reading: the tree arrives asynchronously, so reading the DOM
 * straight after a refresh returns an empty list and every assertion built on it compares against
 * `undefined` instead of failing where the problem is.
 */
async function folderOrder(page: Page): Promise<string[]> {
  // Top level only: a repository's worktrees are nested folders, which are reorderable but are
  // not the thing groups are made of, so including them here would make every caller wrong.
  const labels = page.locator(
    'div.project-row-wrap[data-depth="0"] > button[data-testid="project-toggle"] .project-label',
  )
  await expect(labels.first()).toBeVisible()
  return labels.allInnerTexts()
}

test('a folder can be dragged above another, and stays there across a restart', async () => {
  const before = await folderOrder(h.page)
  expect(before.length).toBeGreaterThan(1)
  const last = before[before.length - 1]
  expect(before[0]).not.toBe(last)

  await folder(h.page, last).dragTo(folder(h.page, before[0]))
  expect((await folderOrder(h.page))[0]).toBe(last)

  // The whole point of arranging the sidebar is that it is still arranged tomorrow.
  await relaunchApiary(h)
  expect((await folderOrder(h.page))[0]).toBe(last)
})

test('a folder can be filed into a group of its own making, which persists', async () => {
  const names = await folderOrder(h.page)
  const first = names[0]

  await folder(h.page, first).click({ button: 'right' })
  await h.page.getByTestId('context-menu-new-group').click()

  // Naming the group is part of making it, rather than a second step through a dialog.
  const rename = h.page.getByTestId('folder-group-rename')
  await expect(rename).toBeFocused()
  await rename.fill('Unwanted')
  await rename.press('Enter')

  const group = h.page.getByTestId('folder-group')
  await expect(group).toHaveCount(1)
  await expect(group.getByTestId('folder-group-toggle')).toContainText('Unwanted')
  await expect(group.locator(`.project-label:text-is("${first}")`)).toBeVisible()

  await relaunchApiary(h)
  await expect(h.page.getByTestId('folder-group-toggle')).toContainText('Unwanted')
})

test('a group collapses, so the folders filed under it are out of the way', async () => {
  const first = (await folderOrder(h.page))[0]
  await folder(h.page, first).click({ button: 'right' })
  await h.page.getByTestId('context-menu-new-group').click()
  await h.page.getByTestId('folder-group-rename').press('Enter')

  // Exact match: the fixture has both "repo-c" and "repo-c-wt", and a substring match would
  // silently be about two different folders.
  const group = h.page.getByTestId('folder-group')
  const row = group.locator(`.project-label:text-is("${first}")`)
  await expect(row).toBeVisible()
  await group.getByTestId('folder-group-toggle').click()
  await expect(row).toHaveCount(0)
})

test('deleting a group frees its folders instead of taking them with it', async () => {
  const names = await folderOrder(h.page)
  const first = names[0]

  await folder(h.page, first).click({ button: 'right' })
  await h.page.getByTestId('context-menu-new-group').click()
  await h.page.getByTestId('folder-group-rename').press('Enter')
  await expect(h.page.getByTestId('folder-group')).toHaveCount(1)

  await h.page.getByTestId('folder-group-toggle').click({ button: 'right' })
  await h.page.getByTestId('context-menu-delete-group').click()

  await expect(h.page.getByTestId('folder-group')).toHaveCount(0)
  // The heading is gone; the folder it held is not.
  expect(await folderOrder(h.page)).toEqual(expect.arrayContaining([first]))
})

test('a group can be renamed from its own menu', async () => {
  const first = (await folderOrder(h.page))[0]
  await folder(h.page, first).click({ button: 'right' })
  await h.page.getByTestId('context-menu-new-group').click()
  await h.page.getByTestId('folder-group-rename').fill('Old name')
  await h.page.getByTestId('folder-group-rename').press('Enter')

  await h.page.getByTestId('folder-group-toggle').click({ button: 'right' })
  await h.page.getByTestId('context-menu-rename-group').click()
  const rename = h.page.getByTestId('folder-group-rename')
  await rename.fill('Archive')
  await rename.press('Enter')

  await expect(h.page.getByTestId('folder-group-toggle')).toContainText('Archive')
})


test('a folder can be dropped into a group that is still empty', async () => {
  // The reported bug: an empty group is a heading and a line of placeholder text, and only the
  // heading accepted a drop — so filing the *first* folder into a new group, the case that needs
  // dragging most, had almost nothing to aim at.
  const names = await folderOrder(h.page)
  const [first, second] = names

  await folder(h.page, first).click({ button: 'right' })
  await h.page.getByTestId('context-menu-new-group').click()
  await h.page.getByTestId('folder-group-rename').fill('Unwanted')
  await h.page.getByTestId('folder-group-rename').press('Enter')

  // Empty it again, so the group on screen is the empty case.
  await folder(h.page, first).click({ button: 'right' })
  await h.page.getByTestId('context-menu-remove-from-group').click()
  const group = h.page.getByTestId('folder-group')
  await expect(group.getByTestId('folder-group-empty')).toBeVisible()

  await folder(h.page, second).dragTo(group)
  await expect(group.locator(`.project-label:text-is("${second}")`)).toBeVisible()
  await expect(group.getByTestId('folder-group-empty')).toHaveCount(0)
})

test('groups reorder by dragging one heading onto another', async () => {
  const names = await folderOrder(h.page)

  for (const [folderName, groupName] of [[names[0], 'First'], [names[1], 'Second']]) {
    await folder(h.page, folderName).click({ button: 'right' })
    await h.page.getByTestId('context-menu-new-group').click()
    await h.page.getByTestId('folder-group-rename').fill(groupName)
    await h.page.getByTestId('folder-group-rename').press('Enter')
  }

  const headings = h.page.getByTestId('folder-group-toggle')
  await expect(headings).toHaveText([/First/, /Second/])

  await headings.last().dragTo(headings.first())
  await expect(headings).toHaveText([/Second/, /First/])

  await relaunchApiary(h)
  await expect(h.page.getByTestId('folder-group-toggle')).toHaveText([/Second/, /First/])
})

test('a session row says where it ran, on what branch, and when it was last active', async () => {
  const row = h.page.getByTestId('session-item').filter({ hasText: 'Worktree session' })
  const tooltip = await row.getAttribute('title')
  expect(tooltip).toContain('Worktree session')
  expect(tooltip).toContain('repo-c-wt')
  expect(tooltip).toContain('branch: feature/wt')
  expect(tooltip).toContain('last active:')
})
