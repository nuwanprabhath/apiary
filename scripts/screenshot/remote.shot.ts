import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { Page } from '@playwright/test'
import { run, startBed, type Bed } from '../../tests/remote/harness'
import { launchApp } from '../../tests/remote/workApp'
import { launchHome, type HomeApp } from '../../tests/remote/homeApp'
import type { ApiaryApi } from '../../src/shared/api'
import { invoiceStory, syncStory, themeStory } from './stories'

/**
 * Not a test: the script behind `docs/screenshot-remote.png` (`npm run screenshot:remote`). It starts
 * the Docker remote-access test bed (an Ubuntu container running the built app as the WORK machine),
 * connects this Mac's app (the HOME machine) to it over real SSH, and photographs the window that
 * opens for the work machine. Nothing on that window is faked: the badge, the sessions and the
 * slash commands all arrive over the connection. Needs Docker.
 */
// The page the script drives is the renderer, so it sees the bridge the preload exposes.
declare global {
  interface Window { apiary: ApiaryApi }
}

const FIXTURE = '/home/dev/fixture'
const SESSIONS = [
  { id: 'b2c3d4e5-0001-4b00-8b00-000000000001', folder: 'billing-api', title: 'Fix duplicate invoice emails on webhook retry', story: invoiceStory },
  { id: 'b2c3d4e5-0002-4b00-8b00-000000000002', folder: 'web-app', title: 'Add a dark mode toggle to settings', story: themeStory },
  { id: 'b2c3d4e5-0003-4b00-8b00-000000000003', folder: 'data-pipeline', title: 'Nightly sync times out on large accounts', story: syncStory },
]

let bed: Bed
let home: HomeApp | undefined

beforeAll(async () => { bed = await startBed() })
afterAll(async () => {
  await home?.app.close().catch(() => undefined)
  if (bed !== undefined) {
    await run('pkill', ['-f', join(bed.dir, 'ssh_config')])
    await bed.exec(['pkill', '-u', 'dev', '-f', 'electron'])
    await bed.stop()
  }
})

it('captures docs/screenshot-remote.png', async () => {
  await launchApp(bed, { claudeBin: '/app/scripts/screenshot/fake-claude.sh', transcriptChat: true, remoteAccess: true }, { APIARY_DEFAULT_THEME: '' })
  // The bed's own one-line fixture session is not part of the story.
  await bed.exec(['rm', '-rf', `${FIXTURE}/projects/-work-a`])
  // The work machine's sessions: written on the host, copied in, owned by `dev`.
  const stage = join(bed.dir, 'sessions')
  for (const s of SESSIONS) {
    const dir = join(stage, `-${s.folder}`)
    mkdirSync(dir, { recursive: true })
    const tail = JSON.stringify({ type: 'ai-title', aiTitle: s.title, sessionId: s.id })
    writeFileSync(join(dir, `${s.id}.jsonl`), `${[...s.story(s.id, `${FIXTURE}/${s.folder}`), tail].join('\n')}\n`)
    await bed.exec(['mkdir', '-p', `${FIXTURE}/${s.folder}`])
    await bed.copyIn(dir, `${FIXTURE}/projects/`)
  }
  await bed.exec(['chown', '-R', 'dev:dev', FIXTURE])

  const sshConfig = join(bed.dir, 'ssh_config')
  home = await launchHome(bed.dir, sshConfig, { headed: true, settings: { transcriptChat: true }, env: { APIARY_DEFAULT_THEME: '' } })
  const opened = home.app.waitForEvent('window', { timeout: 120_000 })
  await vi.waitFor(async () => { await home!.page.evaluate(() => window.apiary.remoteConnect('apiary-test')) }, { timeout: 90_000, interval: 2000 })
  const remote: Page = await opened
  await remote.locator('html[data-ready="true"]').waitFor({ state: 'attached' })
  await vi.waitFor(async () => {
    expect(await home!.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()))).toContain('apiary-test — Apiary')
  }, { timeout: 30_000 })
  await home.app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'apiary-test — Apiary')
    w?.setSize(1760, 1050)
    w?.center()
    w?.focus()
  })

  await remote.evaluate(async (ids) => {
    const all = await window.apiary.discovered()
    await window.apiary.importSessions(all.map((s) => s.sessionId).filter((id) => ids.includes(id)), [])
  }, SESSIONS.map((s) => s.id))
  await remote.getByTestId('sidebar-refresh').click()
  const row = remote.locator('.sidebar').getByTestId('session-item').filter({ hasText: SESSIONS[0].title })
  await vi.waitFor(async () => { expect(await row.count()).toBe(1) }, { timeout: 30_000 })
  await row.click()
  await remote.getByTestId('chat-tool').first().waitFor({ timeout: 30_000 }).catch(async (e: unknown) => {
    throw e
  })

  // Sending resumes the session as a chat on the work machine: its Claude (a stand-in) starts, reports
  // its commands, and keeps working on a long turn, so the working line is on screen.
  const input = remote.getByTestId('composer-input')
  await input.fill('Both are in, thanks. Now run the whole suite and the linter, and fix anything else that breaks.')
  await input.press('Enter')
  await remote.getByTestId('chat-working').waitFor({ timeout: 60_000 })
  await remote.getByTestId('chat-working').filter({ hasText: /\d+m \d+s|\d+s/ }).first().waitFor({ timeout: 30_000 })
  // "/" lists the work machine's slash commands, which Claude on that machine reported.
  await input.click()
  await input.fill('/')
  await remote.getByTestId('composer-commands').waitFor({ timeout: 30_000 })
  await remote.getByText('/compact', { exact: true }).first().waitFor({ timeout: 30_000 })
  for (const close of await remote.getByTestId('notification-close').all()) await close.click()
  await remote.mouse.move(2, 2)

  await remote.screenshot({ path: join(process.cwd(), 'docs', 'screenshot-remote.png') })
}, 900_000)
