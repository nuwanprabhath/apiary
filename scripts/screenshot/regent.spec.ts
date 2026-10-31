import { test, expect } from '@playwright/test'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApiary, relaunchApiary, importAll, sidebarSession, type Harness } from '../../tests/e2e/helpers'
import { invoiceStory, syncStory, themeStory } from './stories'

const FAKE_CLAUDE = join(process.cwd(), 'scripts', 'screenshot', 'fake-claude-regent.mjs')

const SESSIONS = {
  invoices: { id: 'b1b2c3d4-0001-4a00-8a00-000000000001', folder: 'billing-api', title: 'Fix duplicate invoice emails on webhook retry' },
  theme: { id: 'b1b2c3d4-0002-4a00-8a00-000000000002', folder: 'web-app', title: 'Add a dark mode toggle to settings' },
  sync: { id: 'b1b2c3d4-0003-4a00-8a00-000000000003', folder: 'data-pipeline', title: 'Nightly sync times out on large accounts' },
}

/** Sessions that talk about auth and about !1175, as Claude Code writes them (just a turn or two each). */
const TALKS = [
  {
    id: 'b1b2c3d4-0010-4a00-8a00-000000000010', folder: 'core', title: 'Design token auth between core and wildobs', branch: 'auth-design',
    turns: [
      ['user', 'How should wildobs authenticate to core? Design the service token auth: core signs short-lived tokens, wildobs verifies them.'],
      ['assistant', 'Core signs a 15-minute service token per caller; wildobs only verifies the signature, stores no credentials, and refresh stays in core so a revoked service stops within one token lifetime.'],
    ],
  },
  {
    id: 'b1b2c3d4-0011-4a00-8a00-000000000011', folder: 'wildobs', title: 'Roll out service tokens to wildobs', branch: 'service-tokens',
    turns: [
      ['user', 'Roll out the service token auth from the core design to wildobs: verify the token on every request.'],
      ['assistant', 'Added a verifier middleware for the service token auth and a test for an expired token. Key rotation is still open.'],
    ],
  },
  {
    id: 'b1b2c3d4-0012-4a00-8a00-000000000012', folder: 'wildobs', title: 'Fix token refresh race in the upload client', branch: 'fix-refresh-race',
    turns: [
      ['user', 'Review feedback on !1175: the upload client can refresh the token twice at once. Can you fix that?'],
      ['assistant', 'Made the refresh a single in-flight promise, so concurrent uploads share one refresh. Pushed to !1175.'],
    ],
  },
]

function writeSession(h: Harness, s: { id: string; folder: string; title: string }, lines: string[]): void {
  mkdirSync(join(h.home, s.folder), { recursive: true })
  const dir = join(h.projectsRoot, `-${s.folder}`)
  mkdirSync(dir, { recursive: true })
  const tail = JSON.stringify({ type: 'ai-title', aiTitle: s.title, sessionId: s.id })
  writeFileSync(join(dir, `${s.id}.jsonl`), `${[...lines, tail].join('\n')}\n`)
}

function talk(h: Harness, t: (typeof TALKS)[number]): void {
  const cwd = join(h.home, t.folder)
  const start = Date.parse('2026-10-28T09:14:00.000Z')
  const lines = t.turns.map(([role, text], i) => JSON.stringify({
    sessionId: t.id, cwd, gitBranch: t.branch, isSidechain: false, version: '2.1.286', type: role, uuid: `${role[0]}-${String(i)}`,
    timestamp: new Date(start + i * 60_000).toISOString(),
    message: { role, content: role === 'user' ? text : [{ type: 'text', text }] },
  }))
  writeSession(h, t, lines)
}

/** Executables written to a directory the app's `PATH` gets: `glab` that is logged in, so the MR desk has nothing missing. */
function toolsDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-shot-tools-')))
  const run = (name: string, body: string): void => { writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`); chmodSync(join(dir, name), 0o755) }
  run('glab', 'exit 0')
  run('claude', `exec node ${JSON.stringify(FAKE_CLAUDE)} "$@"`)
  return dir
}

const ALWAYS = { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '00:00' }

/**
 * Not a test: launches the real app with Regent and the MR desk on, asks Regent two things, and
 * overwrites `docs/screenshot-regent.png`. Run it with `npm run screenshot:regent`. Both
 * residents' `claude` is `fake-claude-regent.mjs`, which calls Apiary's MCP tools for real.
 */
test('capture the Regent README screenshot', async () => {
  test.setTimeout(300000)
  process.env.APIARY_HEADED = '1'
  const tools = toolsDir()
  const h: Harness = await launchApiary({
    fakeLiveSessionId: '33333333-3333-3333-3333-333333333333',
    realDefaultTheme: true,
    claudeBin: join(tools, 'claude'),
    settings: {
      transcriptChat: true,
      residents: [
        { id: 'regent', kind: 'regent', name: 'Regent', enabled: true, model: 'default', digestModel: 'default', schedule: ALWAYS, pauseAboveUsagePercent: 0 },
        {
          id: 'mr-desk', kind: 'mr-desk', name: 'MR Desk', enabled: true, model: 'default', digestModel: 'default', schedule: ALWAYS, pauseAboveUsagePercent: 0,
          options: { project: 'wildobs/core', repoPath: '' },
        },
      ],
    },
  })
  writeSession(h, SESSIONS.invoices, invoiceStory(SESSIONS.invoices.id, join(h.home, SESSIONS.invoices.folder)))
  writeSession(h, SESSIONS.theme, themeStory(SESSIONS.theme.id, join(h.home, SESSIONS.theme.folder)))
  writeSession(h, SESSIONS.sync, syncStory(SESSIONS.sync.id, join(h.home, SESSIONS.sync.folder)))
  for (const t of TALKS) talk(h, t)

  // The MR desk's clone is a real folder, written into the settings file before the relaunch reads it.
  const clone = join(h.home, 'core')
  const userData = await h.app.evaluate(({ app }) => app.getPath('userData'))
  const settingsFile = join(userData, 'settings.json')
  const { readFileSync } = await import('node:fs')
  const saved = JSON.parse(readFileSync(settingsFile, 'utf8')) as { residents: Array<{ id: string; options: Record<string, string> }> }
  const desk = saved.residents.find((r) => r.id === 'mr-desk')
  if (desk === undefined) throw new Error('the MR desk is not in the saved settings')
  desk.options.repoPath = clone
  writeFileSync(settingsFile, JSON.stringify(saved))

  await relaunchApiary(h, { PATH: `${tools}:${process.env.PATH ?? ''}` })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await h.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1760, 1050) })
  await sidebarSession(h.page, SESSIONS.invoices.title).click()

  // The MR desk's cycle, started from its right-click menu: its claude raises the badge over MCP.
  await h.page.getByTestId('resident-badge-mr-desk').click({ button: 'right' })
  await h.page.getByTestId('resident-menu').getByRole('menuitem', { name: 'Check my MRs now' }).click()
  // The action opens the desk's chat, and an open chat counts as seen: close it before the flag is raised.
  await h.page.getByTestId('resident-popup-close').click()
  await expect(h.page.getByTestId('resident-popup')).toHaveCount(0)
  await expect(h.page.getByTestId('resident-badge-mr-desk').getByTestId('resident-count')).toHaveText('2', { timeout: 30000 })

  // Regent: open a session by merge-request number, then a question answered from several.
  await h.page.getByTestId('resident-badge-regent').click()
  const popup = h.page.getByTestId('resident-popup')
  await expect(popup).toBeVisible()
  // Larger than the default, so both exchanges fit without scrolling.
  const corner = (await popup.getByTestId('resident-popup-resize-corner').boundingBox())!
  const [cx, cy] = [corner.x + corner.width / 2, corner.y + corner.height / 2]
  await h.page.mouse.move(cx, cy)
  await h.page.mouse.down()
  await h.page.mouse.move(cx - 160, cy - 330, { steps: 8 })
  await h.page.mouse.up()
  const box = popup.getByRole('textbox')
  await box.fill('Open the session for !1175')
  await box.press('Enter')
  await expect(popup.getByTestId('resident-session-chip')).toHaveCount(1, { timeout: 30000 })
  await expect(h.page.locator('[data-testid="session-tab"][data-active="true"]')).toContainText('Fix token refresh race')
  await box.fill('What auth did we design between core and wildobs?')
  await box.press('Enter')
  await expect(popup.getByTestId('resident-session-chip')).toHaveCount(3, { timeout: 30000 })
  await expect(popup).not.toContainText('MCP FAILED')
  await expect(popup).toContainText('Key rotation')

  await h.page.mouse.move(2, 2)
  for (const close of await h.page.getByTestId('notification-close').all()) await close.click()
  await h.page.screenshot({ path: join(process.cwd(), 'docs', 'screenshot-regent.png') })
  await h.close()
})
