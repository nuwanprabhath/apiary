import { test, expect } from '@playwright/test'
import { launchApiary, type Harness, sidebarSession } from './helpers'

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
