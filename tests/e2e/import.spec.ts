import { test, expect } from '@playwright/test'
import { launchApiary, relaunchApiary, type Harness } from './helpers'

/**
 * Most of the import dialog's behaviour moved to tests/component/import.test.tsx, driven against
 * the fake `window.apiary`. What is left here needs the real disk: a filesystem watcher picking up
 * a session written after launch, a real rescan racing that watcher, a real relaunch to prove a
 * setting survives it, and clicking the native scrollbar's own arrow buttons (unreliable to
 * automate outside a real launch — see the component test file for what was measured).
 */

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

  test('auto-imports a new session added to an already-imported folder without a re-import', { tag: '@smoke' }, async () => {
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

  // @serial: it proves which path answered by timing (well inside the watcher's 1.5 s window), and
  // under three other apps' load the button's own rescan can take longer than that margin.
  test('the sidebar Refresh button rescans disk immediately, without waiting for the watcher (Finding 2)', { tag: '@serial' }, async () => {
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

test('the scrollbar has arrow buttons that step by a line, not a page', async () => {
  // Without them a long list can only be dragged or paged — there is no way to nudge it when the
  // row you want is a single line out of view.
  //
  // Kept here rather than moved down: in tests/component/import.test.tsx's browser-mode harness,
  // synthetic mouse events reach the hover state that reveals these buttons (`data-scrolling`
  // activates, and the coordinates land inside the button's box) but do not register as a click on
  // the native `::-webkit-scrollbar-button` chrome itself, so `scrollTop` never moves. That is a
  // property of automating native scrollbar UI in that environment, not of the fake.
  const h = await launchApiary({
    extraSessions: Array.from({ length: 25 }, (_, i) => ({
      slug: `-bulk-${String(i)}`,
      sessionId: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, '0')}`,
      title: `Bulk fixture session ${String(i)}`,
    })),
  })
  try {
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
  } finally {
    await h.close()
  }
})

test('the dialog can be dragged wider, and the width sticks across a relaunch', async () => {
  // Session titles and folder paths both run long; a fixed-width dialog ellipsizes exactly the
  // part you opened it to read.
  const h = await launchApiary()
  try {
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
  } finally {
    await h.close()
  }
})
