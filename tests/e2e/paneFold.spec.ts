import { test, expect } from '@playwright/test'
import { launchApiary, importAll, type Harness, sidebarSession, relaunchApiary } from './helpers'

/** A folded pane is part of the window's layout: it is still folded after a relaunch. */

let h: Harness

test.afterEach(async () => { await h.close() })

test('a folded pane stays folded across a relaunch, and unfolds', async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('session-tab-split').first().click()
  await expect(h.page.getByTestId('session-column')).toHaveCount(2)
  await h.page.getByTestId('window-layout-button').click()
  await h.page.getByTestId('layout-option-halves-v').first().click()
  await expect(h.page.getByTestId('content')).toHaveAttribute('data-preset', 'halves-v')
  await h.page.keyboard.press('Escape')

  const top = (): ReturnType<Harness['page']['getByTestId']> => h.page.getByTestId('session-column').first()
  await top().getByTestId('pane-collapse').click()
  await expect(top()).toHaveAttribute('data-folded', 'true')

  await relaunchApiary(h)
  await expect(h.page.getByTestId('content')).toHaveAttribute('data-preset', 'halves-v')
  await expect(top()).toHaveAttribute('data-folded', 'true')
  await expect(top().getByTestId('pane-collapse')).toHaveAttribute('aria-expanded', 'false')

  await top().getByTestId('pane-collapse').click()
  await expect(top()).toHaveAttribute('data-folded', 'false')
})
