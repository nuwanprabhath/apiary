import { test, expect, type Locator, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchApiary, importAll, relaunchApiary, type Harness } from './helpers'
import { STANDARD_SESSIONS } from '../fixtures/standard'

/**
 * The residents' use cases in the real app. `claude` is tests/fixtures/fake-claude-resident.mjs,
 * scripted per message by `scenarios.json` (its header says how) and speaking real MCP to Apiary;
 * its steps that hold wait for a `release-<name>` file, so each intermediate state is observed
 * on a condition. The MR desk runs the vendored `mra` with the real `python3` against a fake
 * `glab` that answers with canned JSON: no network, no real claude.
 */
const FAKE_CLAUDE = fileURLToPath(new URL('../fixtures/fake-claude-resident.mjs', import.meta.url))
const ALWAYS = { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '00:00' }
const REF_SESSION = { slug: '-work-ref', sessionId: '55555555-5555-5555-5555-555555555555', title: 'Parser review', firstPrompt: 'Please review !4242 before the merge' }
const MR = JSON.stringify({
  iid: 5, title: 'fix: the thing', description: '', web_url: 'https://gitlab.com/group/project/-/merge_requests/5',
  author: { username: 'alice' }, assignees: [], reviewers: [{ username: 'me' }],
  source_branch: 'f', target_branch: 'dev/1.0.12', labels: [], draft: false, sha: 'a'.repeat(40),
  updated_at: '2026-10-28T00:00:00Z', created_at: '2026-10-01T00:00:00Z', has_conflicts: false,
  detailed_merge_status: 'mergeable', head_pipeline: { id: 9, status: 'success', web_url: 'u' },
})
/**
 * Answers the `glab` calls `mra poll` and `mra desk` make for group/project; anything else is an
 * empty list. While a `hold-glab` file is in `dir`, each API call waits for `release-glab`.
 */
const fakeGlab = (dir: string): string => `#!/bin/sh
[ "$1" = auth ] && exit 0
if [ -e '${dir}/hold-glab' ]; then while [ ! -e '${dir}/release-glab' ]; do sleep 0.1; done; fi
for last; do :; done
case "$last" in
  user) echo '{"username":"me"}' ;;
  projects/group%2Fproject) echo '{"id":7}' ;;
  *merge_requests?state=opened*) echo '[${MR}]' ;;
  */approvals) echo '{"approved_by":[]}' ;;
  *merge_requests/5) echo '${MR}' ;;
  *) echo '[]' ;;
esac
`
/** A resident's first claude starts through a login shell: slow when four of these run on a busy machine. */
const FIRST_START_MS = 30_000
const HAS_PYTHON =spawnSync('python3', ['--version']).status === 0

const SCENARIOS = {
  'Can you check it now': [{ text: 'I looked, and there is nothing new.' }],
  'Review 1559': [
    { tool: 'Bash', command: 'mra prompt 1559', until: 'bash' },
    { tool: 'Agent', description: 'reviewing !1559', until: 'agent' },
    { text: 'The review is done and looks good.', until: 'text' },
  ],
  'Look at 1047': [{ ask: { tool: 'Bash', command: 'glab mr view 1047' } }, { text: 'The command was {decision}.' }],
  'Run one MR desk cycle': [
    { tool: 'Bash', command: 'mra poll', run: true },
    { mcp: 'set_attention', args: { count: 2, summary: '2 MRs ready to approve' } },
    { text: 'Two MRs are ready to approve.' },
  ],
}

interface World { dir: string; bin: string; clone: string; release: (name: string) => void }

function makeWorld(): World {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-residents-e2e-')))
  const bin = join(dir, 'bin')
  const clone = join(dir, 'clone')
  mkdirSync(bin)
  mkdirSync(clone)
  writeFileSync(join(bin, 'glab'), fakeGlab(dir))
  chmodSync(join(bin, 'glab'), 0o755)
  const scenarios = join(dir, 'scenarios.json')
  writeFileSync(scenarios, JSON.stringify({ path: bin, scenarios: SCENARIOS }))
  writeFileSync(join(dir, 'claude'), `#!/bin/sh\nFAKE_RESIDENT_SCENARIOS=${JSON.stringify(scenarios)} exec node ${JSON.stringify(FAKE_CLAUDE)} "$@"\n`)
  chmodSync(join(dir, 'claude'), 0o755)
  return { dir, bin, clone, release: (name) => { writeFileSync(join(dir, `release-${name}`), '') } }
}

const resident = (id: string, kind: string, name: string): Record<string, unknown> => ({
  id, kind, name, enabled: true, model: 'default', digestModel: 'default', schedule: ALWAYS, pauseAboveUsagePercent: 0,
})

let h: Harness | null = null
let world: World

async function launch(residents: Record<string, unknown>[], extra: Partial<Parameters<typeof launchApiary>[0]> = {}): Promise<Harness> {
  h = await launchApiary({ claudeBin: join(world.dir, 'claude'), settings: { residents }, ...extra })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  return h
}

test.beforeEach(() => { world = makeWorld() })

test.afterEach(async () => {
  await h?.close()
  h = null
  rmSync(world.dir, { recursive: true, force: true })
})

const badge = (page: Page, id: string): Locator => page.getByTestId(`resident-badge-${id}`)
const pill = (page: Page, id: string): Locator => badge(page, id).locator('.resident-activity')
const popup = (page: Page): Locator => page.getByTestId('resident-popup')

async function send(page: Page, text: string): Promise<void> {
  await popup(page).getByRole('textbox').fill(text)
  await popup(page).getByRole('textbox').press('Enter')
}

/** The badge's state and pill words together, so a poll never accepts working with an empty pill. */
async function looks(page: Page, id: string): Promise<{ state: string | null; pill: string }> {
  const state = await badge(page, id).getAttribute('data-state')
  const words = (await pill(page, id).textContent()) ?? ''
  if (state === 'working' && words === '') throw new Error('working with an empty pill')
  return { state, pill: words }
}

async function menu(page: Page, id: string, item: string): Promise<void> {
  await badge(page, id).click({ button: 'right' })
  await page.getByTestId('resident-menu').getByRole('menuitem', { name: item }).click()
}

test.describe('Regent', () => {
  test('lookups: a ref shows match cards that open the session, a plain request shows none, chips open, history survives', { tag: '@smoke' }, async () => {
    const { page } = await launch([resident('regent', 'regent', 'Regent')], { extraSessions: [REF_SESSION] })
    // The ref index is ready once the sidebar's search finds the session by its content.
    await page.getByTestId('search-input').fill('4242')
    await expect(page.getByTestId('session-item').filter({ hasText: REF_SESSION.title })).toHaveCount(1)
    await page.getByTestId('search-input').fill('')

    await badge(page, 'regent').click()
    await send(page, 'What happened with !4242?')
    const hit = popup(page).getByTestId('resident-hit')
    await expect(hit).toHaveCount(1)
    await expect(hit).toContainText(REF_SESSION.title)
    const activeTab = page.locator('[data-testid="session-tab"][data-active="true"]')
    await expect(activeTab).toContainText(REF_SESSION.title)
    await activeTab.getByTestId('session-tab-close').click()
    await hit.click()
    await expect(activeTab).toContainText(REF_SESSION.title)

    await send(page, 'Can you check it now? I think you have access')
    await expect(popup(page)).toContainText('there is nothing new')
    await expect(popup(page).getByTestId('resident-hit')).toHaveCount(1)

    await send(page, 'CSV export')
    const chip = popup(page).getByTestId('resident-session-chip').filter({ hasText: STANDARD_SESSIONS.csv.title })
    await expect(chip).toHaveCount(1)
    await page.locator('[data-testid="session-tab"][data-active="true"]').getByTestId('session-tab-close').click()
    await chip.click()
    await expect(activeTab).toContainText(STANDARD_SESSIONS.csv.title)
    await page.getByTestId('resident-popup-close').click()

    await relaunchApiary(h!)
    await badge(h!.page, 'regent').click()
    await expect(popup(h!.page)).toContainText('Can you check it now? I think you have access')
    await expect(popup(h!.page)).toContainText('there is nothing new')
    await expect(popup(h!.page).getByTestId('resident-session-chip').filter({ hasText: STANDARD_SESSIONS.csv.title })).toHaveCount(1)
  })

  test('words as work happens: the command, the helper, writing, then idle', async () => {
    const { page } = await launch([resident('regent', 'regent', 'Regent')])
    await badge(page, 'regent').click()
    await send(page, 'Review 1559 for me')
    const working = popup(page).getByTestId('resident-working')

    await expect.poll(() => looks(page, 'regent'), { timeout: FIRST_START_MS }).toEqual({ state: 'working', pill: 'Running mra prompt 1559' })
    await expect(working).toContainText('Running mra prompt 1559')
    await expect(working.locator('.busy-glyph')).toHaveCount(1)
    await page.getByTestId('resident-popup-close').click()
    await badge(page, 'regent').hover()
    await expect(page.getByTestId('resident-hover-regent').getByTestId('resident-hover-now')).toContainText('Running mra prompt 1559')
    await page.mouse.move(0, 0)
    await expect(page.getByTestId('resident-hover-regent')).toHaveCount(0)
    await badge(page, 'regent').click()
    world.release('bash')

    await expect.poll(() => looks(page, 'regent')).toEqual({ state: 'working', pill: 'Helper: reviewing !1559' })
    await expect(working).toContainText('Helper: reviewing !1559')
    world.release('agent')

    await expect.poll(() => looks(page, 'regent')).toEqual({ state: 'working', pill: 'Writing' })
    await expect(working).toContainText('Writing')
    world.release('text')

    await expect.poll(() => looks(page, 'regent')).toEqual({ state: 'idle', pill: '' })
    await expect(pill(page, 'regent')).toBeHidden()
    await expect(working).toHaveCount(0)
    await expect(popup(page)).toContainText('The review is done and looks good.')
  })

  for (const choice of ['allow', 'deny'] as const) {
    test(`a permission asked, then ${choice === 'allow' ? 'allowed' : 'denied'}`, async () => {
      const { page } = await launch([resident('regent', 'regent', 'Regent')])
      await badge(page, 'regent').click()
      await send(page, 'Look at 1047')
      await expect(badge(page, 'regent').getByTestId('resident-count')).toHaveText('1', { timeout: FIRST_START_MS })
      await expect.poll(() => looks(page, 'regent')).toEqual({ state: 'working', pill: 'Working' })
      await page.getByTestId('resident-popup-close').click()
      await badge(page, 'regent').hover()
      await expect(page.getByTestId('resident-hover-needs')).toHaveText(/Waiting for your OK/)
      await page.mouse.move(0, 0)
      await badge(page, 'regent').click()
      const card = popup(page).getByTestId('resident-permission')
      await expect(card).toContainText('glab mr view 1047')
      await card.getByTestId(`resident-permission-${choice}`).click()
      await expect(popup(page)).toContainText(`The command was ${choice === 'allow' ? 'allowed' : 'denied'}.`)
      await expect(card).toHaveCount(0)
      await expect(badge(page, 'regent').getByTestId('resident-count')).toHaveCount(0)
    })
  }

  test('right-click turns it off, opens its Settings card, and a saved name and lookback survive a relaunch', async () => {
    const { page } = await launch([resident('regent', 'regent', 'Regent')])
    await expect(badge(page, 'regent')).toHaveAttribute('data-state', 'idle')
    await menu(page, 'regent', 'Settings…')
    await expect(page.getByTestId('settings-dialog')).toBeVisible()
    await expect(page.getByTestId('resident-card-regent')).toBeInViewport()

    await page.getByTestId('resident-name-regent').fill('Queen')
    await page.getByTestId('resident-name-regent').press('Enter')
    await page.getByTestId('resident-lookback-regent').selectOption('3m')
    await page.getByTestId('settings-save').click()
    await expect(page.getByTestId('settings-dialog')).toHaveCount(0)
    await expect(badge(page, 'regent')).toHaveAttribute('aria-label', /^Queen:/)

    await menu(page, 'regent', 'Turn off')
    await expect(badge(page, 'regent')).toHaveAttribute('data-state', 'asleep')

    await relaunchApiary(h!)
    const again = h!.page
    await expect(badge(again, 'regent')).toHaveAttribute('aria-label', /^Queen:/)
    await expect(badge(again, 'regent')).toHaveAttribute('data-state', 'asleep')
    await menu(again, 'regent', 'Settings…')
    await expect(again.getByTestId('resident-name-regent')).toHaveValue('Queen')
    await expect(again.getByTestId('resident-lookback-regent')).toHaveValue('3m')
  })
})

test.describe('the MR desk', () => {
  let savedPath: string | undefined

  // Main finds `glab` (the setup probe, quick actions) on its own PATH, which it takes from ours.
  test.beforeEach(() => { savedPath = process.env.PATH; process.env.PATH = `${world.bin}:${savedPath ?? ''}` })

  test.afterEach(() => { process.env.PATH = savedPath })

  test('set up by URL and folder, Check now raises its attention, the desk shows, Check every moves the next check', async () => {
    test.info().skip(!HAS_PYTHON, 'the MR desk runs the vendored mra, which needs python3 on PATH')
    const { page } = await launch([resident('mr-desk', 'mr-desk', 'MR desk')], { pickFolder: world.clone })
    await menu(page, 'mr-desk', 'Settings…')
    await expect(page.getByTestId('resident-card-mr-desk')).toBeInViewport()
    await page.getByTestId('resident-option-mr-desk-project').fill('https://gitlab.com/group/project')
    await page.getByTestId('resident-option-mr-desk-project').press('Tab')
    await page.getByTestId('resident-option-choose-mr-desk-repoPath').click()
    await expect(page.getByTestId('resident-option-mr-desk-repoPath')).toContainText('clone')
    await expect(page.getByTestId('resident-card-mr-desk').locator('.resident-required')).toHaveCount(0)

    await page.getByTestId('resident-check-now-mr-desk').click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('settings-dialog')).toHaveCount(0)
    await expect(badge(page, 'mr-desk')).toHaveAttribute('data-needs', 'true', { timeout: FIRST_START_MS })
    await expect(badge(page, 'mr-desk').getByTestId('resident-count')).toHaveText('2')
    await expect.poll(() => looks(page, 'mr-desk')).toEqual({ state: 'idle', pill: '2 MRs ready to approve' })

    await badge(page, 'mr-desk').click()
    await expect(popup(page)).toContainText('Two MRs are ready to approve.')
    await expect(badge(page, 'mr-desk')).not.toHaveAttribute('data-needs', 'true')

    writeFileSync(join(world.dir, 'hold-glab'), '')
    await menu(page, 'mr-desk', 'Show the desk')
    await expect.poll(() => looks(page, 'mr-desk')).toEqual({ state: 'working', pill: 'Reading the desk' })
    await expect(popup(page).getByTestId('resident-action').last()).toHaveText('Show the desk')
    await expect(popup(page).getByTestId('resident-working')).toHaveText('Reading the desk')
    world.release('glab')
    await expect.poll(() => looks(page, 'mr-desk')).toEqual({ state: 'idle', pill: '' })
    await expect(popup(page).getByTestId('resident-working')).toHaveCount(0)
    await expect(popup(page)).toContainText('fix: the thing')
    await expect(popup(page)).toContainText('Waiting on you')
    await expect(popup(page)).not.toContainText('failed')
    await page.getByTestId('resident-popup-close').click()

    await menu(page, 'mr-desk', 'Settings…')
    const next = page.getByTestId('resident-next-check-mr-desk')
    await expect(next).toContainText('Next check')
    const before = await next.textContent()
    await page.getByTestId('resident-cycle-mr-desk').selectOption('5')
    await expect(next).not.toHaveText(before ?? '')
    const after = await next.textContent()
    await page.keyboard.press('Escape')
    await badge(page, 'mr-desk').hover()
    const checks = page.getByTestId('resident-hover-mr-desk').getByTestId('resident-hover-checks')
    await expect(checks).toContainText('Every 5 min')
    await expect(checks).toContainText((after ?? '').replace(/^Next check (at )?/, ''))
  })
})
