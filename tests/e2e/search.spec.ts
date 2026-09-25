import { test, expect } from '@playwright/test'
import { launchApiary, importAll, type Harness } from './helpers'

/**
 * Opens Settings the way the other settings tests do.
 *
 * Not via the keyboard accelerator: that is handled by Electron's native menu, which never sees
 * keys sent to the page — pressing it here does nothing at all.
 */
async function openSettings(h: Harness): Promise<void> {
  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog')
  })
  await expect(h.page.getByTestId('settings-dialog')).toBeVisible()
}

let h: Harness

test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})

test.afterEach(async () => { await h.close() })

const search = (h: Harness) => h.page.getByTestId('search-input')

test('finds a session by something said in it, not just by its title', async () => {
  // "empty" appears in this session's first message and in no session's title — so a hit can only
  // have come from the conversation itself.
  await search(h).fill('empty')

  const items = h.page.getByTestId('session-item')
  await expect(items).toHaveCount(1)
  await expect(items).toContainText('Fix CSV export bug')
})

test('turning off content search falls back to titles alone', async () => {
  await search(h).fill('empty')
  await expect(h.page.getByTestId('session-item')).toHaveCount(1)

  await search(h).fill('')
  await openSettings(h)
  await h.page.getByTestId('settings-nav-search').click()
  await h.page.getByTestId('setting-search-chat-content').uncheck()
  await h.page.getByTestId('settings-save').click()

  await search(h).fill('empty')
  await expect(h.page.getByTestId('sidebar-no-matches')).toBeVisible()

  // The title search it falls back to still works, so this is narrower, not broken.
  await search(h).fill('CSV')
  await expect(h.page.getByTestId('session-item')).toHaveCount(1)
})

test('settings reports how much has been indexed, and can rebuild it', async () => {
  await openSettings(h)
  await h.page.getByTestId('settings-nav-search').click()

  // The fixture has several sessions, all imported above; the exact number is the fixture's
  // business, so this asserts only that indexing has actually happened.
  await expect(h.page.getByTestId('search-index-status')).not.toContainText('0 sessions indexed')

  await h.page.getByTestId('search-rebuild').click()
  await expect(h.page.getByTestId('search-rebuild')).toBeEnabled({ timeout: 30000 })
  await expect(h.page.getByTestId('search-index-status')).not.toContainText('0 sessions indexed')

  await h.page.getByTestId('settings-cancel').click()
  // And search still works against the rebuilt index.
  await search(h).fill('empty')
  await expect(h.page.getByTestId('session-item')).toHaveCount(1)
})

/**
 * How many sessions the scale test seeds. A real library reaches this order of magnitude, and the
 * cost of a search is per row — five fixture sessions cost nothing to re-render and would measure
 * nothing at all, which is exactly why an earlier version of this test passed while the app was
 * unusable.
 */
const SCALE = 400

test('the search box keeps up with typing, with a realistic number of sessions', { tag: '@serial' }, async () => {
  // The reported bug: typing "test" stalls at "te" and the rest of the word lands seconds later.
  // Seeded before launch, which is the only point the scan picks new project folders up.
  const many = await launchApiary({
    extraSessions: Array.from({ length: SCALE }, (_, i) => ({
      slug: `-bulk-${String(i)}`,
      sessionId: `bulk${String(i).padStart(4, '0')}-0000-4000-8000-${String(i).padStart(12, '0')}`,
      title: `Test session number ${String(i)} about exports and pipelines`,
      firstPrompt: `work item ${String(i)}`,
      // Real conversation content, not just a title. A one-character query matches essentially
      // every chunk of it, which is what makes the content search return thousands of ids and the
      // renderer filter and rank a set that size — the condition an empty fixture never reaches.
      padTurns: 30,
    })),
  })
  try {
    await importAll(many.page)
    await many.page.getByTestId('sidebar-refresh').click()
    // Counted through the tree, not the DOM: folders render collapsed, so visible rows say nothing
    // about how much the sidebar is actually working with.
    await expect.poll(
      () => many.page.evaluate(async () => {
        const count = (nodes: { sessions: unknown[]; children: unknown[] }[]): number =>
          nodes.reduce((n, x) => n + x.sessions.length + count(
            x.children as { sessions: unknown[]; children: unknown[] }[],
          ), 0)
        return count(await window.apiary.tree())
      }),
      { timeout: 60000 },
    ).toBeGreaterThan(SCALE - 10)

    await many.page.getByTestId('search-input').click()

    // Measured as main-thread long tasks, not as "how soon did a value change".
    //
    // The first version of this measurement dispatched input events and waited a frame, and it
    // passed while the app was visibly stalling — `requestAnimationFrame` resolves before React's
    // lower-priority work runs, so it timed the cheap half and missed the render entirely. A long
    // task *is* the symptom: while one runs, nothing is painted and no keystroke is handled, which
    // is precisely "I typed and the letter did not appear".
    await many.page.evaluate(() => {
      const w = window as unknown as { __jank: number[] }
      w.__jank = []
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.__jank.push(entry.duration)
      }).observe({ entryTypes: ['longtask'] })
    })

    // Real keystrokes, through the real event pipeline, at a plausible typing speed.
    await many.page.keyboard.type('test', { delay: 60 })
    // Read without waiting: the text must already be there the moment typing stops. A polling
    // assertion here would pass even if the letters trickled in over a second, which is the very
    // thing being tested.
    await expect(many.page.getByTestId('search-input')).toHaveValue('test')
    // Let whatever the last keystroke scheduled actually run, so a stall after the final
    // character is caught rather than measured only up to it.
    // eslint-disable-next-line playwright/no-wait-for-timeout -- the thing under test is the longest main-thread task over a fixed window after typing stops; there is no condition to poll for instead
    await many.page.waitForTimeout(2000)

    const worst = await many.page.evaluate(
      () => Math.max(0, ...(window as unknown as { __jank: number[] }).__jank),
    )

    // Generous, and deliberately about the main thread rather than the results: the results are
    // allowed to take their time, the keyboard is not. A task longer than this is a visible freeze.
    expect(worst).toBeLessThan(250)
  } finally {
    await many.close()
  }
})

