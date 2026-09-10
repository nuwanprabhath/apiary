import { test, expect } from '@playwright/test'
import { launchApiary, relaunchApiary, type Harness, sidebarSession } from './helpers'

/** The menu lives in the main process, so trigger the same channel it sends. */
async function openImportDialog(harness: Harness): Promise<void> {
  await harness.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-import-dialog')
  })
  await expect(harness.page.getByTestId('import-dialog')).toBeVisible()
}

test.describe('default fixture (one session per group)', () => {
  let h: Harness
  test.beforeEach(async () => { h = await launchApiary() })
  test.afterEach(async () => { await h.close() })

  test('lists every discovered session grouped by folder', async () => {
    await openImportDialog(h)
    await expect(h.page.getByTestId('import-group')).toHaveCount(4)
    await expect(h.page.getByTestId('import-session-checkbox')).toHaveCount(4)
    // This one is the row inside the dialog, not the sidebar behind it.
    await expect(h.page.getByTestId('import-dialog').getByText('Fix CSV export bug')).toBeVisible()
  })

  test('imports only the ticked sessions', async () => {
    await openImportDialog(h)
    await h.page.getByTestId('import-session-checkbox').first().check()
    await h.page.getByTestId('import-confirm').click()

    await expect(h.page.getByTestId('import-dialog')).toHaveCount(0)
    await expect(h.page.getByTestId('session-item')).toHaveCount(1)
  })

  test('searching narrows the list', async () => {
    await openImportDialog(h)
    await h.page.getByTestId('import-search').fill('csv')
    await expect(h.page.getByTestId('import-session-checkbox')).toHaveCount(1)
  })

  test('cancelling imports nothing', async () => {
    await openImportDialog(h)
    await h.page.getByTestId('import-session-checkbox').first().check()
    await h.page.getByTestId('import-cancel').click()
    await expect(h.page.getByTestId('import-dialog')).toHaveCount(0)
    await expect(h.page.getByTestId('sidebar-empty')).toBeVisible()
  })

  test('already-imported sessions come back ticked and disabled', async () => {
    await openImportDialog(h)
    await h.page.getByTestId('import-session-checkbox').first().check()
    await h.page.getByTestId('import-confirm').click()
    await expect(h.page.getByTestId('session-item')).toHaveCount(1)

    await openImportDialog(h)
    const first = h.page.getByTestId('import-session-checkbox').first()
    await expect(first).toBeChecked()
    await expect(first).toBeDisabled()
  })

  test('auto-imports a new session added to an already-imported folder without a re-import', async () => {
    await openImportDialog(h)
    const workAGroup = h.page.getByTestId('import-group').filter({ hasText: h.workdir })
    await workAGroup.getByTestId('import-group-checkbox').check()
    await h.page.getByTestId('import-confirm').click()
    await expect(h.page.getByTestId('session-item')).toHaveCount(1)

    const { makeSession } = await import('../fixtures/makeSession')
    makeSession(h.projectsRoot, '-work-a', {
      sessionId: '66666666-6666-6666-6666-666666666666',
      cwd: h.workdir,
      title: 'A brand new session in work-a',
    })

    await expect(h.page.getByTestId('session-item')).toHaveCount(2, { timeout: 10000 })
  })

  test('the sidebar Refresh button rescans disk immediately, without waiting for the watcher (Finding 2)', async () => {
    await openImportDialog(h)
    const workAGroup = h.page.getByTestId('import-group').filter({ hasText: h.workdir })
    await workAGroup.getByTestId('import-group-checkbox').check()
    await h.page.getByTestId('import-confirm').click()
    await expect(h.page.getByTestId('session-item')).toHaveCount(1)

    const { makeSession } = await import('../fixtures/makeSession')
    makeSession(h.projectsRoot, '-work-a', {
      sessionId: '99999999-9999-9999-9999-999999999999',
      cwd: h.workdir,
      title: 'Picked up by the Refresh button',
    })

    await h.page.getByTestId('sidebar-refresh').click()
    // The watcher's own debounce+settle window is at least 1500ms (1000ms debounce plus a
    // 500ms awaitWriteFinish stability threshold), so a pass within well under that margin
    // can only be the button's own rescan, not the watcher happening to fire in the background.
    await expect(h.page.getByTestId('session-item')).toHaveCount(2, { timeout: 900 })
  })
})

test.describe('folder with two sessions', () => {
  // Scoped to this describe block only, rather than added to the shared default fixture: the
  // default fixture's every group holds exactly one session (see helpers.ts), which is exactly
  // what makes the other tests in this file able to assert exact-count totals (4 groups, 4
  // checkboxes) without those counts drifting for reasons unrelated to what each test covers.
  // A second session in "work-a" is needed only to prove that ticking a folder header selects
  // *every* session in that folder, not just one — so it is added only here, via a second
  // `-work-a` fixture write (same directory, same cwd, distinct sessionId) that lands in the
  // same discovered group as the existing work-a session.
  let h: Harness
  test.beforeEach(async () => {
    h = await launchApiary({
      extraSessions: [
        {
          slug: '-work-a',
          sessionId: '77777777-7777-7777-7777-777777777777',
          title: 'Second session in work-a',
        },
      ],
    })
  })
  test.afterEach(async () => { await h.close() })

  test('ticking the folder header selects every session in it', async () => {
    await openImportDialog(h)

    const workAGroup = h.page.getByTestId('import-group').filter({ hasText: h.workdir })
    const workBGroup = h.page.getByTestId('import-group').filter({ hasText: h.workdirB })

    // Sanity on the fixture shape itself: work-a now holds two sessions, work-b still one.
    await expect(workAGroup.getByTestId('import-session-checkbox')).toHaveCount(2)
    await expect(workBGroup.getByTestId('import-session-checkbox')).toHaveCount(1)

    await workAGroup.getByTestId('import-group-checkbox').check()

    // Both of work-a's sessions must now be checked...
    const workASessionCheckboxes = workAGroup.getByTestId('import-session-checkbox')
    await expect(workASessionCheckboxes.nth(0)).toBeChecked()
    await expect(workASessionCheckboxes.nth(1)).toBeChecked()
    await expect(h.page.getByTestId('import-count')).toContainText('2')

    // ...while work-b, a different group, is untouched.
    await expect(workBGroup.getByTestId('import-session-checkbox')).not.toBeChecked()

    await h.page.getByTestId('import-confirm').click()
    await expect(h.page.getByTestId('import-dialog')).toHaveCount(0)

    // Both of work-a's sessions actually made it through the import, not just one of them.
    await expect(sidebarSession(h.page, 'Fix CSV export bug')).toBeVisible()
    await expect(sidebarSession(h.page, 'Second session in work-a')).toBeVisible()
    await expect(h.page.getByTestId('session-item')).toHaveCount(2)
  })
})

test.describe('folder checkbox state', () => {
  let h: Harness
  test.beforeEach(async () => { h = await launchApiary() })
  test.afterEach(async () => { await h.close() })

  test('a folder whose every session is already imported shows as checked, not unchecked', async () => {
    // The header used to count only the sessions ticked in *this* visit, so a folder that was
    // fully imported on a previous one came back with an unchecked box — which reads as "none of
    // this folder is in", when in fact all of it is.
    await openImportDialog(h)
    const group = h.page.getByTestId('import-group').filter({ hasText: h.workdir })
    await group.getByTestId('import-group-checkbox').check()
    await h.page.getByTestId('import-confirm').click()
    await expect(h.page.getByTestId('session-item')).toHaveCount(1)

    await openImportDialog(h)
    const again = h.page.getByTestId('import-group').filter({ hasText: h.workdir })
    await expect(again.getByTestId('import-group-checkbox')).toBeChecked()
    // Still disabled — there is nothing left in it to change — but it now says so honestly.
    await expect(again.getByTestId('import-group-checkbox')).toBeDisabled()
  })

  test('ticking every session in a folder one by one checks the folder itself', async () => {
    await h.close()
    h = await launchApiary({
      extraSessions: [
        { slug: '-work-a', sessionId: '77777777-7777-7777-7777-777777777777', title: 'Second in work-a' },
      ],
    })
    await openImportDialog(h)
    const group = h.page.getByTestId('import-group').filter({ hasText: h.workdir })
    const boxes = group.getByTestId('import-session-checkbox')
    await expect(boxes).toHaveCount(2)

    const groupBox = group.getByTestId('import-group-checkbox')
    await expect(groupBox).not.toBeChecked()

    await boxes.nth(0).check()
    // One of two: neither in nor out, and the box says so rather than claiming either.
    await expect(groupBox).not.toBeChecked()
    expect(await groupBox.evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(true)

    await boxes.nth(1).check()
    await expect(groupBox).toBeChecked()
    expect(await groupBox.evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(false)
  })

  test('the scrollbar has arrow buttons that step by a line, not a page', async () => {
    // Without them a long list can only be dragged or paged — there is no way to nudge it when the
    // row you want is a single line out of view.
    await h.close()
    h = await launchApiary({
      extraSessions: Array.from({ length: 25 }, (_, i) => ({
        slug: `-bulk-${String(i)}`,
        sessionId: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, '0')}`,
        title: `Bulk fixture session ${String(i)}`,
      })),
    })
    await openImportDialog(h)

    const list = h.page.locator('.import-list')
    await list.evaluate((el) => { el.scrollTop = 300 })
    const box = (await list.boundingBox())!
    const before = await list.evaluate((el) => el.scrollTop)
    expect(before).toBe(300)

    // The up arrow sits in the scrollbar gutter at the very top of the element.
    await h.page.mouse.click(box.x + box.width - 6, box.y + 6)
    await expect.poll(async () => list.evaluate((el) => el.scrollTop)).toBeLessThan(before)
    const afterUp = await list.evaluate((el) => el.scrollTop)
    // A step, not a page: paging would have travelled the list's whole visible height.
    expect(before - afterUp).toBeLessThan(box.height / 2)

    // ...and the down arrow at the bottom steps back the other way.
    await h.page.mouse.click(box.x + box.width - 6, box.y + box.height - 6)
    await expect.poll(async () => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(afterUp)
  })
})

test.describe('dialog behaviour', () => {
  let h: Harness
  test.beforeEach(async () => { h = await launchApiary() })
  test.afterEach(async () => { await h.close() })

  test('Escape closes the import dialog', async () => {
    await openImportDialog(h)
    await h.page.keyboard.press('Escape')
    await expect(h.page.getByTestId('import-dialog')).toHaveCount(0)
  })

  test('the dialog can be dragged wider, and the width sticks across a relaunch', async () => {
    // Session titles and folder paths both run long; a fixed-width dialog ellipsizes exactly the
    // part you opened it to read.
    await openImportDialog(h)
    const dialog = h.page.getByTestId('import-dialog')
    const before = (await dialog.boundingBox())!

    const handle = (await h.page.getByTestId('import-resizer-right').boundingBox())!
    await h.page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await h.page.mouse.down()
    await h.page.mouse.move(handle.x + handle.width / 2 + 120, handle.y + handle.height / 2, { steps: 10 })
    await h.page.mouse.up()

    const after = (await dialog.boundingBox())!
    expect(after.width).toBeGreaterThan(before.width + 100)

    await h.page.getByTestId('import-cancel').click()
    await relaunchApiary(h)
    await openImportDialog(h)
    const reopened = (await h.page.getByTestId('import-dialog').boundingBox())!
    expect(Math.abs(reopened.width - after.width)).toBeLessThan(4)
  })

  test('one checkbox selects every session listed', async () => {
    await openImportDialog(h)
    await expect(h.page.getByTestId('import-count')).toContainText('0 selected')

    await h.page.getByTestId('import-select-all').check()
    await expect(h.page.getByTestId('import-count')).toContainText('4 selected')
    await expect(h.page.getByTestId('import-session-checkbox').nth(0)).toBeChecked()
    await expect(h.page.getByTestId('import-session-checkbox').nth(3)).toBeChecked()

    // Unticking it puts everything back, rather than leaving a half-selected mess behind.
    await h.page.getByTestId('import-select-all').uncheck()
    await expect(h.page.getByTestId('import-count')).toContainText('0 selected')
  })

  test('select-all follows the search, so it never quietly picks rows you filtered out', async () => {
    await openImportDialog(h)
    await h.page.getByTestId('import-search').fill('csv')
    await expect(h.page.getByTestId('import-session-checkbox')).toHaveCount(1)

    await h.page.getByTestId('import-select-all').check()
    await expect(h.page.getByTestId('import-count')).toContainText('1 selected')
  })

  test('hovering a session shows its full name and how old it is', async () => {
    await openImportDialog(h)
    // The visible label is ellipsized to fit; the tooltip is where the whole thing lives, along
    // with the one other fact you need to tell two similar sessions apart.
    const row = h.page.locator('.import-row').filter({ hasText: 'Fix CSV export bug' })
    const tip = await row.getAttribute('title')
    expect(tip).toContain('Fix CSV export bug')
    expect(tip).toMatch(/Last active/i)
  })
})
