import { test, expect, type Page, type Locator } from '@playwright/test'
import { writeFileSync, chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'
import { makeSession } from '../fixtures/makeSession'

/**
 * A terminal's tab follows the session Claude says the process is on.
 *
 * Reported: a new session in which the user typed `/resume` stayed a `new:<uuid>` tab for good —
 * its pty id shown in Active, pinning it did nothing, it never reached Recent, Fork was greyed out.
 * Measured with a real Haiku session, Claude records the switch in `<config>/sessions/<pid>.json`
 * (`/clear` and `/resume` change `sessionId` in place). Apiary had been guessing instead, from new
 * JSONLs appearing in the folder, and a resume onto a session that already existed is exactly the
 * one the guess rules out.
 *
 * The stand-in `claude` below writes that file the way Claude does, then becomes a shell. Its `$$`
 * is the pty's own pid: sessions run as `$SHELL -l -c 'exec <claude> …'`, and exec keeps the pid.
 * `tests/e2e/live/` repeats this against a real `claude --model haiku`.
 */

const FIX_CSV = '11111111-1111-1111-1111-111111111111'

async function useClaudeThatResumes(h: Harness, sessionId: string): Promise<void> {
  mkdirSync(join(h.home, 'sessions'), { recursive: true })
  const script = join(h.home, 'fake-claude.sh')
  writeFileSync(script, [
    '#!/bin/sh',
    `printf '{"pid":%s,"sessionId":"${sessionId}","name":"work-a-7","nameSource":"derived","status":"idle"}' "$$" > "$APIARY_CONFIG_ROOT/sessions/$$.json"`,
    'exec "$SHELL" -l',
    '',
  ].join('\n'))
  chmodSync(script, 0o755)
  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog')
  })
  await h.page.getByTestId('settings-nav-general').click()
  await h.page.getByTestId('claude-bin-input').fill(script)
  await h.page.getByTestId('settings-save').click()
  await expect(h.page.getByTestId('settings-dialog')).toHaveCount(0)
}

function groupLabelled(page: Page, label: string): Locator {
  return page.locator(
    `li[data-testid="project-group"]:has(> div > button[data-testid="project-toggle"] .project-label:text-is("${label}"))`,
  )
}

let h: Harness
test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})
test.afterEach(async () => { await h.close() })

test('a new session that resumes an existing one becomes that session\'s tab everywhere', async () => {
  await useClaudeThatResumes(h, FIX_CSV)
  await groupLabelled(h.page, 'work-a').getByTestId('new-session-button').click()

  // The header stops saying "New session" and names the session the process is really on.
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')

  // Active shows its title, not a `new:<uuid>` pty id.
  const active = h.page.getByTestId('active-section').getByTestId('active-tab-row')
  await expect(active).toHaveCount(1)
  await expect(active).toContainText('Fix CSV export bug')
  await expect(active).not.toContainText('new:')

  // And the tab is a real session now: pinning it from the tab's menu lands in Pinned.
  await h.page.getByTestId('session-tab-bar').getByText('Fix CSV export bug').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: /pin/i }).click()
  await expect(h.page.getByTestId('pinned-section')).toContainText('Fix CSV export bug')
})

test('it keeps the live terminal rather than starting a second process for the session', async () => {
  await useClaudeThatResumes(h, FIX_CSV)
  await groupLabelled(h.page, 'work-a').getByTestId('new-session-button').click()
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')

  // Still showing the terminal, not flipped to the transcript. Asserted as visibility: a hidden
  // terminal still accepts a forced click and still has text, which is how an earlier version of
  // this test passed while the user was looking at the transcript instead.
  const terminal = h.page.getByTestId('terminal-session')
  await expect(terminal).toBeVisible()
  await h.page.waitForTimeout(1500)
  await expect(terminal).toBeVisible()
  // Typed into the terminal after the tab changed hands: it reaches the same shell.
  await terminal.click({ force: true })
  await h.page.keyboard.type('echo STILL_THE_SAME_PTY\n')
  await expect(terminal).toContainText('STILL_THE_SAME_PTY')
  // .first(): once it is a real session it is listed in the tree and in Recent both.
  await expect(sidebarSession(h.page, 'Fix CSV export bug').first()).toBeVisible()
})

test('a session whose transcript only appears after its terminal started is still picked up', async () => {
  // The ordering real Claude has, and the one the first version of this fix missed: the session
  // file exists from startup, but the JSONL only from the first message — so the session is not in
  // the tree when Apiary first learns its id. Caught by the live Haiku spec, not by the test above,
  // whose session already existed.
  const later = '88888888-8888-4888-8888-888888888888'
  await useClaudeThatResumes(h, later)
  const workA = groupLabelled(h.page, 'work-a')
  const cwd = await workA.locator('.project-row-wrap').first().getAttribute('data-folder-path')
  if (cwd === null) throw new Error('work-a has no path')
  await workA.getByTestId('new-session-button').click()
  await expect(h.page.getByTestId('session-title')).toContainText('New session')
  await h.page.waitForTimeout(2500) // several tracker polls go by with nothing in the tree yet

  makeSession(join(h.home, 'projects'), '-work-a', {
    sessionId: later, cwd, title: 'Written on the first message', firstPrompt: 'hello',
  })
  await h.page.getByTestId('sidebar-refresh').click()

  await expect(h.page.getByTestId('session-title')).toHaveText('Written on the first message')
  await expect(h.page.getByTestId('active-section').getByTestId('active-tab-row')).not.toContainText('new:')
})
