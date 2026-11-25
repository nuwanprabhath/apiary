import { test, expect } from '@playwright/test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchApiary, importAll, sidebarSession } from '../../../../tests/e2e/helpers'
import { note, shot } from './lib'

const R = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..')
const RESIDENT = `${R}/tests/fixtures/fake-claude-resident.mjs`
const send = (c: string) => [({ BrowserWindow }: typeof import('electron'), ch: string) => { BrowserWindow.getAllWindows()[0].webContents.send(ch) }, c] as const
/**
 * What changed between the 1.71.3 and 1.89.0 audits, live: a limit Claude Code hit turning the usage
 * meter to 100%, the dashboard on click, the size presets and resize mode; Settings' Slack section and
 * the settings version; long-titled tabs at their cap; residents added from Settings, their menu, MR
 * Desk's setup banner and the popup's message times.
 */
const inHours = (h: number): string => new Date(Date.now() + h * 3_600_000).toISOString()
const clock = (ms: number): string => {
  const d = new Date(ms)
  const h = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12
  return `${String(h)}:${String(d.getMinutes()).padStart(2, '0')}${d.getHours() < 12 ? 'am' : 'pm'}`
}

test('usage: numbers, a limit Claude Code hit, the panel on click, size presets and resize mode', async () => {
  process.env.APIARY_FAKE_USAGE = JSON.stringify({ five_hour: { utilization: 80, resets_at: inHours(2) }, seven_day: { utilization: 31, resets_at: inHours(80) } })
  const h = await launchApiary({ settings: { plugins: { 'claude-usage': true } } })
  delete process.env.APIARY_FAKE_USAGE
  const q = h.page
  try {
    // The stand-in answers for a sign-in the user already allowed: no consent prompt.
    const item = q.getByTestId('status-item-claude-usage-usage')
    await expect(item).toContainText('5h 80%')
    // Claude Code refuses a request for the limit after that fetch: the bar must say 100%.
    const at = Date.now() + 60_000
    const dir = join(h.projectsRoot, '-audit-limit')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'limit-session.jsonl'), `${JSON.stringify({
      type: 'assistant', timestamp: new Date(at).toISOString(), sessionId: 'limit-session', isApiErrorMessage: true, error: 'rate_limit',
      message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: `You've hit your 5-hour limit · resets ${clock(at + 90 * 60_000)} (Local)` }], usage: { input_tokens: 0, output_tokens: 0 } },
    })}\n`)
    await q.getByTestId('status-item-claude-usage-refresh').click()
    await expect(item).toContainText('5h 100%')
    note('usage-after-hit', await item.textContent())
    await item.hover()
    await expect(q.getByTestId('status-hover')).toContainText('Claude Code reported hitting the limit')
    await shot(q, '1-usage-limit-hit')
    await item.click()
    await expect(q.getByTestId('status-panel')).toBeVisible()
    await expect(q.getByTestId('status-panel-refresh')).toBeVisible()
    await shot(q, '2-usage-panel')
    await q.keyboard.press('Escape')
    await expect(q.getByTestId('status-panel')).toHaveCount(0)
    await q.getByTestId('status-bar-floor').click({ button: 'right' })
    await q.getByTestId('context-menu-tall').click()
    await expect.poll(async () => (await q.getByTestId('status-bar').boundingBox())?.height).toBe(52)
    await expect(q.getByTestId('status-bar-resize')).toHaveCount(0)
    await q.getByTestId('status-bar-floor').click({ button: 'right' })
    await q.getByRole('menuitemcheckbox', { name: 'Resize by dragging' }).or(q.getByRole('menuitem', { name: 'Resize by dragging' })).click()
    await expect(q.getByTestId('status-bar-resize')).toBeVisible()
    await shot(q, '3-resize-mode')
  } finally { await h.close() }
})

test('settings: the Slack section, search, and the settings version', async () => {
  const h = await launchApiary()
  const p = h.page
  try {
    await expect(async () => {
      await h.app.evaluate(...send('apiary:open-settings-dialog'))
      await expect(p.getByTestId('settings-dialog')).toBeVisible({ timeout: 1000 })
    }).toPass()
    note('settings-nav', await p.locator('[data-testid^="settings-nav-"]:not([data-testid^="settings-nav-count"])').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid'))))
    await p.getByTestId('settings-nav-slack').click()
    await expect(p.getByTestId('slack-status')).toHaveAttribute('data-connection', 'off')
    await shot(p, '4a-slack-off')
    // No token saved (that would reach the real Keychain): switching on says to add one.
    await p.getByRole('switch', { name: 'Take instructions from Slack' }).click()
    await expect(p.getByTestId('slack-status')).toHaveAttribute('data-connection', 'error')
    note('slack-status-on-without-token', await p.getByTestId('slack-status').textContent())
    await shot(p, '4b-slack-no-token')
    await p.getByRole('switch', { name: 'Take instructions from Slack' }).click()
    await expect(p.getByTestId('slack-status')).toHaveAttribute('data-connection', 'off')
    await p.getByTestId('settings-search').fill('slack')
    await expect(p.getByTestId('settings-results')).toBeVisible()
    await p.getByTestId('settings-search').press('Enter')
    await expect(p.getByTestId('settings-nav-slack')).toHaveAttribute('data-active', 'true')
    await p.getByTestId('settings-search').fill('')
    await p.getByTestId('settings-nav-general').click()
    await p.getByTestId('setting-hide-tool-call-io').click()
    await p.getByTestId('settings-save').click()
    await expect(p.getByTestId('settings-dialog')).toHaveCount(0)
    const saved = JSON.parse(readFileSync(join(h.home, 'userdata', 'settings.json'), 'utf8')) as { schemaVersion?: number }
    note('settings-version', saved.schemaVersion)
    expect(saved.schemaVersion).toBe(3)
  } finally { await h.close() }
})

test('tabs: long titles stop at their cap, the tooltip has the whole title', async () => {
  const long = ['Staging failed to update error after the WAF rule', '#2523 generic Org feedback round two', 'Investigate the nightly pets 3D flake on macOS']
  const h = await launchApiary({ extraSessions: long.map((title, i) => ({ slug: `-audit-long-${String(i)}`, sessionId: `a0d17000-0000-4000-8000-00000000000${String(i)}`, title, firstPrompt: `long ${String(i)}` })) })
  const p = h.page
  try {
    await importAll(p)
    await p.getByTestId('sidebar-refresh').click()
    for (const t of long) await sidebarSession(p, t).click()
    await expect(p.getByTestId('session-tab')).toHaveCount(3)
    const widths = await p.getByTestId('session-tab').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)))
    note('tab-widths', widths)
    for (const w of widths) expect(w).toBeLessThanOrEqual(200)
    await expect(p.getByTestId('session-tab-label').first()).toHaveAttribute('title', long[0] ?? '')
    await shot(p, '5-long-tabs')
  } finally { await h.close() }
})

test('residents: added from Settings, badge menu, popup, MR desk setup banner, message times', async () => {
  const w = join(realpathSync(mkdtempSync(join(tmpdir(), 'apiary-verify-regent-'))), 'claude')
  writeFileSync(w, `#!/bin/sh\nexec node ${JSON.stringify(RESIDENT)} "$@"\n`)
  chmodSync(w, 0o755)
  const h = await launchApiary({ claudeBin: w })
  const p = h.page
  try {
    await importAll(p)
    await p.getByTestId('sidebar-refresh').click()
    await expect(async () => {
      await h.app.evaluate(...send('apiary:open-settings-dialog'))
      await expect(p.getByTestId('settings-dialog')).toBeVisible({ timeout: 1000 })
    }).toPass()
    await p.getByTestId('settings-nav-residents').click()
    await p.getByTestId('resident-add-regent').click()
    await p.getByTestId('resident-add-mr-desk').click()
    await p.keyboard.press('Escape')
    await expect(p.getByTestId('settings-dialog')).toHaveCount(0)
    const ids = await p.locator('[data-testid^="resident-badge-"]').evaluateAll((els) => els.map((e) => `${String(e.getAttribute('data-testid'))}:${String(e.getAttribute('data-state'))}`))
    note('badges', ids)
    const regent = p.locator('[data-testid^="resident-badge-regent"]').first()
    await regent.click({ button: 'right' })
    const menu = p.getByTestId('resident-menu')
    await expect(menu).toBeVisible()
    note('regent-menu', await menu.getByRole('menuitem').allTextContents())
    await shot(p, '6-resident-menu')
    await p.keyboard.press('Escape')
    const desk = p.locator('[data-testid^="resident-badge-mr-desk"]').first()
    await desk.click()
    await expect(p.getByTestId('resident-setup')).toBeVisible()
    await shot(p, '7-mr-desk-setup')
    await p.getByTestId('resident-popup-close').click()

    // Turn the Regent on if it was added off, then ask it something and read the times.
    if ((await regent.getAttribute('data-state')) === 'asleep') {
      await regent.click({ button: 'right' })
      await p.getByTestId('resident-menu').getByRole('menuitem', { name: 'Turn on' }).click()
    }
    await regent.click()
    const popup = p.getByTestId('resident-popup')
    await popup.getByRole('textbox').fill('CSV export')
    await popup.getByRole('textbox').press('Enter')
    await expect(popup.getByTestId('resident-session-chip')).toContainText('Fix CSV export bug')
    await expect(popup.getByTestId('message-time').first()).toBeVisible()
    note('popup-times', await popup.getByTestId('message-time').allTextContents())
    await shot(p, '8-regent-times')
  } finally { await h.close() }
})
