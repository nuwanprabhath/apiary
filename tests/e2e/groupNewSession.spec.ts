import { test, expect } from '@playwright/test'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { launchApiary, importAll, type Harness } from './helpers'

/**
 * A group's "+": pick a folder (the native picker, answered here by `APIARY_PICK_FOLDER`), start
 * Claude there, file the folder under the group. The folder is one Apiary has never seen — only
 * the real main process can prove it accepts a path it got from the dialog, not from the renderer.
 */

let h: Harness
let picked: string

test.beforeEach(async () => {
  // Made before launch, and passed as the picker's answer.
  picked = join(process.env.TMPDIR ?? '/tmp', `apiary-picked-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`)
  mkdirSync(picked, { recursive: true })
  h = await launchApiary({ pickFolder: picked })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})

test.afterEach(async () => {
  await h.close()
  rmSync(picked, { recursive: true, force: true })
})

test('starts Claude in the picked folder', async () => {
  const first = h.page.locator('.project-row-wrap[data-depth="0"]').first()
  await first.click({ button: 'right' })
  await h.page.getByTestId('context-menu-new-group').click()
  await h.page.keyboard.press('Enter')
  const group = h.page.getByTestId('folder-group')
  await expect(group).toBeVisible()

  await group.locator('.folder-group-header-wrap').hover()
  await group.getByTestId('group-new-session-button').click()
  await expect(h.page.getByTestId('terminal-session')).toBeVisible()
  // The new session's header names the folder it runs in: the picked one.
  await expect(h.page.getByRole('heading', { level: 1 })).toContainText(`New session · ${picked.split('/').pop() ?? ''}`)
})
