import { test, expect } from '@playwright/test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'

const FAKE_CODE = join(process.cwd(), 'scripts/fixtures/fake-code.sh')

let h: Harness

test.afterEach(async () => { await h.close() })

test('the button appears when VS Code is detected and opens the session folder', async () => {
  h = await launchApiary({ codePath: FAKE_CODE })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await sidebarSession(h.page, 'Fix CSV export bug').hover()
  const button = h.page.getByTestId('hover-card-open-vscode')
  await expect(button).toBeVisible()
  await button.click()
  await expect.poll(() => existsSync(h.vsCodeLog) ? readFileSync(h.vsCodeLog, 'utf8') : '')
    .toContain(h.workdir)
})

test('the button is absent when VS Code was not found', async () => {
  h = await launchApiary({ codePath: '' })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await sidebarSession(h.page, 'Fix CSV export bug').hover()
  await expect(h.page.getByTestId('hover-card-open-vscode')).toHaveCount(0)
})
