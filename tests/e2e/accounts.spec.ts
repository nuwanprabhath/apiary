import { test, expect } from '@playwright/test'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'
import { STANDARD_SESSIONS } from '../fixtures/standard'

/**
 * Running one session as another Claude account, through the real app: an account added in
 * Settings is a config folder, and switching a chat's account restarts its `claude` with
 * `CLAUDE_CONFIG_DIR` pointing there while the conversation carries on. `claude` is the chat
 * stand-in (tests/fixtures/fake-claude-chat.mjs) behind a wrapper that records the
 * `CLAUDE_CONFIG_DIR` and arguments of each start, so no real login or token is involved.
 */
const FAKE_CHAT = fileURLToPath(new URL('../fixtures/fake-claude-chat.mjs', import.meta.url))

let h: Harness
let starts: string

/** One line per `claude` started: the config folder it was given (`<unset>` for the main account), a tab, its arguments. */
function startLines(): string[][] {
  return existsSync(starts) ? readFileSync(starts, 'utf8').trim().split('\n').map((l) => l.split('\t')) : []
}
const configDirs = (): string[] => startLines().map(([dir]) => dir ?? '')

test.beforeEach(async ({}, testInfo) => {
  starts = testInfo.outputPath('claude-starts.log')
  const wrapper = testInfo.outputPath('claude-wrapper.sh')
  writeFileSync(wrapper, `#!/bin/sh\nprintf '%s\\t%s\\n' "\${CLAUDE_CONFIG_DIR:-<unset>}" "$*" >> ${JSON.stringify(starts)}\nexec ${JSON.stringify(FAKE_CHAT)} "$@"\n`)
  chmodSync(wrapper, 0o755)
  h = await launchApiary({ claudeBin: wrapper, settings: { transcriptChat: true } })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})

test.afterEach(async () => { await h.close() })

test('a chat moved to an added account restarts under its folder and keeps its conversation', async () => {
  // Settings → Accounts → Add account: the folder is made and a login session opens for it.
  // The menu item is main's own IPC; sent until the dialog is up (a just-loaded window can miss it).
  await expect(async () => {
    if (!(await h.page.getByTestId('settings-dialog').isVisible())) {
      await h.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog')
      })
    }
    await expect(h.page.getByTestId('settings-nav-accounts')).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 20000 })
  await h.page.getByTestId('settings-nav-accounts').click()
  await h.page.getByTestId('account-add').click()
  await h.page.getByTestId('account-name').fill('Work')
  await h.page.getByTestId('account-add-confirm').click()
  const folder = join(h.home, 'userdata', 'accounts', 'work')
  await expect.poll(() => existsSync(join(folder, 'projects'))).toBe(true)
  await expect.poll(() => configDirs()).toContain(folder)

  // The /login itself happens inside claude; here it is the file Claude would write.
  writeFileSync(join(folder, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'work@example.test' } }))

  // A chat on the main account, answered.
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('composer-input').fill('before the switch')
  await h.page.getByTestId('composer-input').press('Enter')
  await expect(h.page.getByTestId('chat-text').last()).toContainText('You said: before the switch')
  const mainStarts = configDirs().filter((d) => d === '<unset>').length
  expect(mainStarts).toBeGreaterThan(0)

  // "/" → Account: Main → Work.
  await h.page.getByTestId('composer-commands').click()
  await expect(h.page.locator('[data-action="account"]')).toContainText('Account: Main')
  await h.page.locator('[data-action="account"]').click()
  await expect(h.page.getByTestId('composer-account-option').nth(1)).toContainText('work@example.test')
  await h.page.getByTestId('composer-account-option').nth(1).click()

  // The chat's claude was started again, under the account's folder, on the same conversation.
  await expect.poll(() => configDirs().filter((d) => d === folder).length).toBe(2)
  await h.page.getByTestId('composer-input').fill('after the switch')
  await h.page.getByTestId('composer-input').press('Enter')
  await expect(h.page.getByTestId('chat-text').last()).toContainText('You said: after the switch')
  // Same conversation: the restart resumed this session's id rather than starting a new one.
  const restart = startLines().filter(([dir]) => dir === folder).at(-1)
  expect(restart?.[1]).toContain(`--resume ${STANDARD_SESSIONS.csv.id}`)

  // The tab names the account it now runs under, and so does the "/" menu.
  const tab = h.page.getByTestId('session-tab-label').filter({ hasText: 'Fix CSV export bug' })
  await expect(tab).toHaveAttribute('title', /Account: Work/)
  await h.page.getByTestId('composer-commands').click()
  await expect(h.page.locator('[data-action="account"]')).toContainText('Account: Work')
})
