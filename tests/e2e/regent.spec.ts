import { test, expect } from '@playwright/test'
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchApiary, importAll, relaunchApiary, type Harness } from './helpers'
import { STANDARD_SESSIONS } from '../fixtures/standard'

/**
 * Regent's whole path in the real app: main spawns `claude` with `--mcp-config`, that claude calls
 * Apiary's MCP server over HTTP with its bearer token, `open_session` opens the tab, and the
 * streamed answer shows in the popup with a chip that opens the session again. `claude` is
 * tests/fixtures/fake-claude-resident.mjs; no tokens are spent.
 */
const FAKE_CLAUDE = fileURLToPath(new URL('../fixtures/fake-claude-resident.mjs', import.meta.url))
const TITLE = STANDARD_SESSIONS.csv.title

let h: Harness

test.beforeEach(async () => {
  // Run through node, so the fixture needs no executable bit.
  const wrapper = join(realpathSync(mkdtempSync(join(tmpdir(), 'apiary-regent-e2e-'))), 'claude')
  writeFileSync(wrapper, `#!/bin/sh\nexec node ${JSON.stringify(FAKE_CLAUDE)} "$@"\n`)
  chmodSync(wrapper, 0o755)
  h = await launchApiary({
    claudeBin: wrapper,
    settings: {
      residents: [{
        id: 'regent', kind: 'regent', name: 'Regent', enabled: true, model: 'default', digestModel: 'default',
        schedule: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '00:00' }, pauseAboveUsagePercent: 0,
      }],
    },
  })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})

test.afterEach(async () => { await h.close() })

test('Regent finds a session over MCP, opens its tab, and answers with a chip that opens it again', { tag: '@smoke' }, async () => {
  const { page } = h
  await page.getByTestId('resident-badge-regent').click()
  const popup = page.getByTestId('resident-popup')
  await expect(popup).toBeVisible()

  await popup.getByRole('textbox').fill('CSV export')
  await popup.getByRole('textbox').press('Enter')

  const activeTab = page.locator('[data-testid="session-tab"][data-active="true"]')
  await expect(activeTab).toContainText(TITLE)
  const chip = popup.getByTestId('resident-session-chip')
  await expect(chip).toContainText(TITLE)
  await expect(popup).not.toContainText('MCP FAILED')

  await activeTab.getByTestId('session-tab-close').click()
  await expect(page.getByTestId('session-tab').filter({ hasText: TITLE })).toHaveCount(0)
  await chip.click()
  await expect(activeTab).toContainText(TITLE)

  await expect(popup).toBeVisible()
  await page.getByTestId('resident-popup-close').click()
  await expect(popup).toHaveCount(0)

  await relaunchApiary(h)
  await h.page.getByTestId('resident-badge-regent').click()
  const again = h.page.getByTestId('resident-popup')
  await expect(again).toContainText('CSV export')
  await expect(again.getByTestId('resident-session-chip')).toContainText(TITLE)
})
