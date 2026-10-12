import { test, expect } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApiary, importAll } from '../../../../tests/e2e/helpers'
import { note, shot } from './lib'

/**
 * The 1.39 changes a user touches, in the real app: the Chat | Terminal toggle in the tab bar and
 * the folder path in the title's tooltip; Pin from a row's context menu, saved by main in
 * `library-state.json`; the message box folding away and coming back with the cursor in it; a time
 * on every message.
 */
test('1.39: toggle, pin from the menu, fold the message box, message times', async () => {
  const h = await launchApiary({ realDefaultTheme: true })
  try {
    const { page } = h
    await importAll(page)
    await page.getByTestId('sidebar-refresh').click()
    await expect(page.getByTestId('session-item')).toHaveCount(4)
    await page.getByTestId('session-item').filter({ hasText: 'Fix CSV export bug' }).click()

    // The header is one row: the toggle sits in the tab bar, the path only in the tooltip.
    await expect(page.getByTestId('view-toggle')).toBeVisible()
    await expect(page.getByTestId('session-path')).toHaveCount(0)
    const title = page.getByTestId('session-title')
    const tooltip = await title.getAttribute('title')
    expect(tooltip).toContain('\n/')
    await expect(page.getByTestId('view-transcript')).toHaveAttribute('aria-pressed', 'true')

    // Every message has a time.
    await expect.poll(() => page.getByTestId('message-time').count()).toBeGreaterThanOrEqual(2)
    const times = await page.getByTestId('message-time').count()

    // Pin from the context menu; main writes it to library-state.json.
    await page.getByTestId('session-item').filter({ hasText: 'Add worktree switcher' }).click({ button: 'right' })
    await page.getByTestId('context-menu-pin').click()
    await expect(page.getByTestId('pinned-section')).toBeVisible()
    const userData = await h.app.evaluate(({ app }) => app.getPath('userData'))
    const file = join(userData, 'library-state.json')
    await expect.poll(() => existsSync(file) && (JSON.parse(readFileSync(file, 'utf8')) as { pinned?: string[] }).pinned?.length).toBe(1)

    // Fold the message box away and back.
    const input = page.getByTestId('composer-input')
    await expect(input).toBeVisible()
    const before = await page.getByTestId('composer').boundingBox()
    await page.getByTestId('composer-collapse').click()
    await expect(input).toHaveCount(0)
    const folded = await page.getByTestId('composer').boundingBox()
    await shot(page, 'folded')
    await page.getByTestId('composer-peek').click()
    await expect(page.getByTestId('composer-input')).toBeFocused()

    note('release-1-39', {
      tooltip, times,
      library: JSON.parse(readFileSync(file, 'utf8')) as unknown,
      composerHeight: { before: before?.height, folded: folded?.height },
    })
    await shot(page, 'after')
  } finally {
    await h.close()
  }
})
