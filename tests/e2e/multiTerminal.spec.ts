import { test, expect } from '@playwright/test'
import { launchApiary, importAll, type Harness } from './helpers'

let h: Harness
test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await h.page.getByText('Fix CSV export bug').click()
  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()
})
test.afterEach(async () => { await h.close() })

test('adds a second terminal and switches between them', async () => {
  await h.page.getByTestId('terminal-add').click()
  await h.page.getByTestId('terminal-list-toggle').click()
  await expect(h.page.getByTestId('terminal-tab-row')).toHaveCount(2)

  await h.page.getByTestId('terminal-shell').click()
  await h.page.keyboard.type('echo APIARY_TAB_TWO\n')
  await expect(h.page.getByTestId('terminal-shell')).toContainText('APIARY_TAB_TWO', { timeout: 20000 })

  await h.page.getByTestId('terminal-tab-row').first().getByTestId('terminal-tab-label').click()
  await h.page.getByTestId('terminal-shell').click()
  await h.page.keyboard.type('echo APIARY_TAB_ONE\n')
  await expect(h.page.getByTestId('terminal-shell')).toContainText('APIARY_TAB_ONE', { timeout: 20000 })
  await expect(h.page.getByTestId('terminal-shell')).not.toContainText('APIARY_TAB_TWO')
})

test('switching away from a terminal and back preserves its scrollback', async () => {
  await h.page.getByTestId('terminal-shell').click()
  await h.page.keyboard.type('echo APIARY_TAB_ONE_HISTORY\n')
  await expect(h.page.getByTestId('terminal-shell')).toContainText('APIARY_TAB_ONE_HISTORY', { timeout: 20000 })

  await h.page.getByTestId('terminal-add').click()
  await h.page.getByTestId('terminal-list-toggle').click()
  await expect(h.page.getByTestId('terminal-tab-row')).toHaveCount(2)

  await h.page.getByTestId('terminal-tab-row').first().getByTestId('terminal-tab-label').click()
  await expect(h.page.getByTestId('terminal-shell')).toContainText('APIARY_TAB_ONE_HISTORY', { timeout: 20000 })
})

test('renames a terminal tab', async () => {
  await h.page.getByTestId('terminal-list-toggle').click()
  await h.page.getByTestId('terminal-tab-label').dblclick()
  await h.page.getByTestId('terminal-tab-rename-input').fill('Build watcher')
  await h.page.getByTestId('terminal-tab-rename-input').press('Enter')
  await expect(h.page.getByTestId('terminal-tab-label')).toHaveText('Build watcher')
})

test('deletes a terminal tab, switching to a remaining one', async () => {
  await h.page.getByTestId('terminal-add').click()
  await h.page.getByTestId('terminal-list-toggle').click()
  await expect(h.page.getByTestId('terminal-tab-row')).toHaveCount(2)

  await h.page.getByTestId('terminal-tab-row').last().getByTestId('terminal-tab-delete').click()
  await expect(h.page.getByTestId('terminal-tab-row')).toHaveCount(1)
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()
})

test('deleting the last terminal collapses the pane back to Show shell', async () => {
  await h.page.getByTestId('terminal-list-toggle').click()
  await h.page.getByTestId('terminal-tab-row').getByTestId('terminal-tab-delete').click()
  await expect(h.page.getByTestId('shell-toggle')).toContainText('Show shell')
  await expect(h.page.getByTestId('terminal-shell')).toHaveCount(0)
})
