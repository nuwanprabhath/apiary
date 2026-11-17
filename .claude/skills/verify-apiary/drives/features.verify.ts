import { test, expect } from '@playwright/test'
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchApiary, importAll, sidebarSession } from '../../../../tests/e2e/helpers'
import { note, shot } from './lib'

const R = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..')
/**
 * Every feature the map covers that needs no real `claude`, network or second machine, in four
 * launches: the sidebar (search, pin, the Active section, the row menu), panes and a shell, the
 * remote dialog, usage consent, settings search, themes, accounts, chat with a background task,
 * the "/" actions and the schedule dialog, and the Regent popup over its MCP tools.
 */

const CHAT = `${R}/tests/fixtures/fake-claude-chat.mjs`
const RESIDENT = `${R}/tests/fixtures/fake-claude-resident.mjs`
const send = (c: string) => [({ BrowserWindow }: typeof import('electron'), ch: string) => { BrowserWindow.getAllWindows()[0].webContents.send(ch) }, c] as const

test('sidebar, active, pin, schedule menu, panes, remote dialog', async () => {
  const h = await launchApiary({ realDefaultTheme: true })
  const p = h.page
  try {
    await importAll(p)
    await p.getByTestId('sidebar-refresh').click()
    await expect(p.getByTestId('session-item')).toHaveCount(4)
    await p.getByTestId('search-input').fill('zzqx-nothing')
    await expect(p.getByTestId('sidebar-no-matches')).toBeVisible()
    await p.getByTestId('search-input').fill('')

    await sidebarSession(p, 'Add worktree switcher').click({ button: 'right' })
    await p.getByTestId('context-menu-pin').click()
    await expect(p.getByTestId('pinned-section').getByTestId('session-item')).toHaveCount(1)

    await sidebarSession(p, 'Fix CSV export bug').click()
    await expect(p.getByTestId('active-section')).toBeVisible()
    await expect(p.getByTestId('active-tab-row')).toHaveCount(1)
    await p.getByTestId('search-input').fill('worktree switcher')
    await expect(p.getByTestId('active-tab-row')).toContainText('Fix CSV export bug')
    await p.getByTestId('search-input').fill('')
    await shot(p, '1-sidebar-active-pinned')

    await sidebarSession(p, 'Fix CSV export bug').click({ button: 'right' })
    const items = await p.locator('[data-testid^="context-menu-"]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-testid'), e.getAttribute('aria-disabled') ?? (e as HTMLButtonElement).disabled]))
    note('row-menu', items)
    await shot(p, '2-row-menu')
    await p.keyboard.press('Escape')

    await p.getByTestId('shell-toggle').click()
    await p.getByTestId('terminal-shell').click()
    await p.keyboard.type('echo SHELL_$((3*3))\n')
    await expect(p.getByTestId('terminal-shell')).toContainText('SHELL_9')
    await expect(async () => {
      await p.getByTestId('session-tab').first().hover()
      await p.getByTestId('session-tab-layout').first().hover()
      await expect(p.getByTestId('layout-picker')).toBeVisible({ timeout: 1000 })
    }).toPass()
    await p.getByTestId('layout-zone-halves-h-2').click()
    await expect(p.getByTestId('content')).toHaveAttribute('data-preset', 'halves-h')
    await shot(p, '3-panes')

    await h.app.evaluate(...send('apiary:open-remote-dialog'))
    await expect(p.getByTestId('remote-hosts')).toBeVisible()
    note('remote', { pairing: await p.getByTestId('remote-pairing').count(), offer: await p.getByTestId('remote-offer').count() })
    await shot(p, '4-remote-dialog')
  } finally { await h.close() }
})

test('usage consent, settings search, themes, accounts', async () => {
  const h = await launchApiary({ settings: { plugins: { 'claude-usage': true } } })
  const p = h.page
  try {
    await expect(p.getByTestId('status-consent')).toBeVisible()
    await p.getByTestId('status-consent-allow').click()
    await expect(p.getByTestId('status-bar')).toContainText('sign in')
    await shot(p, '5-usage')

    await expect(async () => {
      await h.app.evaluate(...send('apiary:open-settings-dialog'))
      await expect(p.getByTestId('settings-dialog')).toBeVisible({ timeout: 1000 })
    }).toPass()
    await p.getByTestId('settings-search').fill('interval')
    await expect(p.getByTestId('settings-results')).toBeVisible()
    await shot(p, '6a-settings-results')
    await p.getByTestId('settings-search').press('Enter')
    await expect(p.getByTestId('settings-nav-sessions')).toHaveAttribute('data-active', 'true')
    await shot(p, '6b-settings-found')

    await p.getByTestId('settings-nav-themes').click()
    await expect(p.getByTestId('themes-section')).toBeVisible()
    note('theme-cards', await p.getByTestId('theme-card').count())

    await p.getByTestId('settings-nav-accounts').click()
    await expect(p.getByTestId('accounts-section')).toBeVisible()
    await p.getByTestId('account-add').click()
    await expect(p.getByTestId('account-name')).toBeVisible()
    await shot(p, '7-accounts')
    await p.getByTestId('account-add-cancel').click()
    await p.getByTestId('settings-cancel').click()
  } finally { await h.close() }
})

test('chat, background task, slash actions, schedule dialog', async () => {
  const h = await launchApiary({ claudeBin: CHAT, settings: { transcriptChat: true } })
  const p = h.page
  try {
    await importAll(p)
    await p.getByTestId('sidebar-refresh').click()
    await sidebarSession(p, 'Fix CSV export bug').click()
    await p.getByTestId('composer-input').fill('hello')
    await p.getByTestId('composer-input').press('Enter')
    await expect(p.getByTestId('chat-text').last()).toContainText('You said: hello')
    await p.getByTestId('composer-input').fill('run something in the background')
    await p.getByTestId('composer-input').press('Enter')
    await expect(p.getByTestId('chat-status-tasks')).toContainText('1 background task running')
    await shot(p, '8-bg-task')
    await p.getByTestId('composer-input').fill('/')
    await expect(p.getByTestId('composer-action-option').first()).toBeVisible()
    note('actions', await p.getByTestId('composer-action-option').evaluateAll((els) => els.map((e) => e.getAttribute('data-action'))))
    await shot(p, '9-slash')
    await p.locator('[data-testid="composer-action-option"][data-action="schedule-message"]').click()
    await expect(p.getByTestId('schedule-text')).toBeVisible()
    await shot(p, '10-schedule-dialog')
    await p.getByTestId('schedule-cancel').click()
  } finally { await h.close() }
})

test('regent popup over MCP', async () => {
  const w = join(realpathSync(mkdtempSync(join(tmpdir(), 'apiary-verify-regent-'))), 'claude')
  writeFileSync(w, `#!/bin/sh\nexec node ${JSON.stringify(RESIDENT)} "$@"\n`)
  chmodSync(w, 0o755)
  const h = await launchApiary({ claudeBin: w, settings: { residents: [{ id: 'regent', kind: 'regent', name: 'Regent', enabled: true, model: 'default', digestModel: 'default', schedule: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '00:00' }, pauseAboveUsagePercent: 0 }] } })
  const p = h.page
  try {
    await importAll(p)
    await p.getByTestId('sidebar-refresh').click()
    await p.getByTestId('resident-badge-regent').click()
    const popup = p.getByTestId('resident-popup')
    await popup.getByRole('textbox').fill('CSV export')
    await popup.getByRole('textbox').press('Enter')
    await expect(popup.getByTestId('resident-session-chip')).toContainText('Fix CSV export bug')
    await shot(p, '11-regent')
  } finally { await h.close() }
})
