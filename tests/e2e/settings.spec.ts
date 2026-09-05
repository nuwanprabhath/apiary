import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launchApiary, type Harness } from './helpers'

let h: Harness
test.beforeEach(async () => { h = await launchApiary() })
test.afterEach(async () => { await h.close() })

test('saves an explicit claude binary path', async () => {
  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog')
  })
  await expect(h.page.getByTestId('settings-dialog')).toBeVisible()

  await h.page.getByTestId('claude-bin-input').fill('/opt/custom/claude')
  await h.page.getByTestId('settings-save').click()
  await expect(h.page.getByTestId('settings-dialog')).toHaveCount(0)

  const saved = await h.page.evaluate(() => window.apiary.settingsGet())
  expect(saved.claudeBin).toBe('/opt/custom/claude')

  // The assertion above only proves settingsGet() returns the value — which could be true even
  // if the main process merely held it in memory and never wrote it to disk. Read the actual
  // settings.json the main process wrote (under the throwaway `--user-data-dir` this harness
  // passes to `electron.launch`, a sibling of `projectsRoot`) to prove it was really persisted.
  const home = dirname(h.projectsRoot)
  const settingsFile = join(home, 'userdata', 'settings.json')
  const onDisk = JSON.parse(readFileSync(settingsFile, 'utf8')) as { claudeBin: string | null }
  expect(onDisk.claudeBin).toBe('/opt/custom/claude')
})

test('the empty state explains where sessions are read from', async () => {
  await expect(h.page.getByTestId('sidebar-empty')).toContainText('CLAUDE_CONFIG_DIR')
})
