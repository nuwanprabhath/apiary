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
