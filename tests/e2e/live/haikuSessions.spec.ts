import { test, expect, type Locator } from '@playwright/test'
import { writeFileSync, chmodSync, mkdirSync, existsSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { launchApiary, importAll, type Harness } from '../helpers'

/**
 * The session-identity bugs, against a real `claude --model haiku` rather than a stand-in.
 *
 * Opt-in (`APIARY_LIVE_CLAUDE=1 npm run test:e2e -- live/`): it spends real tokens, needs a
 * logged-in `claude` on PATH, and writes a few short sessions for a throwaway folder into the real
 * `~/.claude/projects`, which it removes afterwards. The app scans the real `~/.claude`; its own
 * database lives in the throwaway harness home, so the user's Apiary is untouched.
 *
 * Every other spec proves the logic with a stand-in that writes `sessions/<pid>.json` the way
 * Claude does. This one proves the stand-in describes Claude — the step whose absence let the
 * activity dots ship wrong twice.
 */
test.skip(process.env.APIARY_LIVE_CLAUDE !== '1', 'live Claude specs are opt-in: APIARY_LIVE_CLAUDE=1')
test.setTimeout(240_000)

const CLAUDE_ROOT = join(homedir(), '.claude')
let h: Harness
let lab: string

/** The Claude projects folder for `lab`, found by name rather than by re-deriving Claude's slug. */
function labProjectDirs(): string[] {
  const name = lab.split('/').pop() ?? ''
  return readdirSync(join(CLAUDE_ROOT, 'projects')).filter((d) => d.endsWith(name)).map((d) => join(CLAUDE_ROOT, 'projects', d))
}

async function useHaiku(): Promise<void> {
  const script = join(h.home, 'claude-haiku.sh')
  writeFileSync(script, '#!/bin/sh\nexec claude --model haiku "$@"\n')
  chmodSync(script, 0o755)
  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog')
  })
  await h.page.getByTestId('settings-nav-general').click()
  await h.page.getByTestId('claude-bin-input').fill(script)
  await h.page.getByTestId('settings-save').click()
  await expect(h.page.getByTestId('settings-dialog')).toHaveCount(0)
}

/** The terminal on screen — with several tabs, the others' terminals stay mounted but hidden. */
const terminal = (): Locator => h.page.locator('[data-testid="terminal-session"]:visible').last()

/** Types into the Claude TUI and presses Enter; answers the folder-trust prompt if it is up. */
async function say(text: string): Promise<void> {
  await terminal().click({ force: true })
  // Claude takes a few seconds to paint; typing before it has is typing into nothing. Its status
  // line names the model once the composer is up.
  await expect(terminal()).toContainText(/trust this folder|Haiku \d/, { timeout: 60_000 })
  // The trust prompt defaults to "No, exit". Enter is pressed only once the cursor is seen on
  // "Yes" — a Down that was dropped followed by an Enter that was not answers "No", Claude exits,
  // and the tab (still pending, so with nothing to show) closes: every later step then finds no
  // terminal at all. That was the whole of the intermittent failures this spec had.
  const screenText = (): Promise<string> => terminal().innerText({ timeout: 3000 }).catch(() => '')
  for (let i = 0; i < 10 && /trust this folder/.test(await screenText()); i++) {
    if (/❯\s*Yes, I trust this folder/.test(await screenText())) {
      await h.page.keyboard.press('Enter')
      await h.page.waitForTimeout(3000)
      continue
    }
    await terminal().click({ force: true })
    await h.page.keyboard.press('ArrowDown')
    await h.page.waitForTimeout(500)
  }
  await expect(terminal()).toContainText(/Haiku \d/, { timeout: 60_000 })
  await h.page.keyboard.type(text, { delay: 10 })
  await h.page.waitForTimeout(400)
  await h.page.keyboard.press('Enter')
}

const DONE = /for \d+s · done/g
// A short timeout per read: the poll retries, and one read landing mid-repaint must not stall it.
const doneCount = async (): Promise<number> =>
  ((await terminal().innerText({ timeout: 3000 }).catch(() => '')).match(DONE) ?? []).length

/**
 * Sends a message and waits for *its* turn to finish — a new "done" line, not any. A forked or
 * resumed session repaints the earlier conversation, "done" lines included, so waiting for the
 * pattern alone returned at once and the next message was typed into a TUI that was not ready,
 * where it was silently lost. That made a fork look unresolved when Claude had written nothing.
 */
async function ask(text: string): Promise<void> {
  await terminal().click({ force: true })
  await expect(terminal()).toContainText(/trust this folder|Haiku \d/, { timeout: 60_000 })
  const before = await doneCount()
  await say(text)
  await expect.poll(doneCount, { timeout: 90_000 }).toBeGreaterThan(before)
}

test.beforeEach(async () => {
  // One fixed folder, reused across runs: Claude remembers trusting it, so after the first run the
  // trust prompt — the flakiest step to drive — never appears. Sessions are still per test: the
  // folder's Claude project directory is emptied before and after each one.
  lab = join(tmpdir(), 'apiary-live-lab')
  mkdirSync(lab, { recursive: true })
  if (!existsSync(join(lab, '.git'))) execFileSync('git', ['init', '-q', lab])
  for (const d of labProjectDirs()) rmSync(d, { recursive: true, force: true })
  // A first session made outside the app, so the folder is in the tree with a "+" to click.
  execFileSync('claude', ['-p', '--model', 'haiku', 'Reply with just the word: seed'], { cwd: lab, stdio: 'ignore' })
  h = await launchApiary({ configRoot: CLAUDE_ROOT })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await useHaiku()
})

test.afterEach(async () => {
  await h.close()
  for (const d of labProjectDirs()) rmSync(d, { recursive: true, force: true })
})

function labFolder(): Locator {
  const name = lab.split('/').pop() ?? ''
  return h.page.locator(`li[data-testid="project-group"]:has(> div > button[data-testid="project-toggle"] .project-label:text-is("${name}"))`)
}

const activeRows = (): Locator => h.page.getByTestId('active-section').getByTestId('active-tab-row')

test('a new session resolves to its real id once Claude writes it — no new:<uuid> left anywhere', async () => {
  await labFolder().getByTestId('new-session-button').click()
  await ask('Reply with just the word: alpha')

  await expect(h.page.getByTestId('session-title')).not.toContainText('New session', { timeout: 30_000 })
  await expect(activeRows().filter({ hasText: 'new:' })).toHaveCount(0)
})

test('/clear moves the tab to the new session Claude starts', async () => {
  await labFolder().getByTestId('new-session-button').click()
  await ask('Reply with just the word: before')
  await expect(h.page.getByTestId('session-title')).not.toContainText('New session', { timeout: 30_000 })
  const before = await h.page.getByTestId('session-title').innerText()

  await say('/clear')
  await h.page.waitForTimeout(3000)
  await ask('Reply with just the word: after')

  // The new session's title comes from its own first prompt.
  await expect(h.page.getByTestId('session-title')).not.toHaveText(before, { timeout: 30_000 })
  await expect(h.page.getByTestId('session-title')).toContainText(/after/i)
  await expect(activeRows()).toHaveCount(1)
})

test('/resume inside a new session becomes the resumed session\'s tab — the reported new:<uuid> case', async () => {
  // The seed session is the one to resume into.
  await labFolder().getByTestId('new-session-button').click()
  await say('/resume')
  await expect(terminal()).toContainText(/seed/i, { timeout: 30_000 })
  await h.page.keyboard.press('Enter')

  await expect(h.page.getByTestId('session-title')).toContainText(/seed/i, { timeout: 30_000 })
  await expect(activeRows()).toContainText(/seed/i)
  await expect(activeRows().filter({ hasText: 'new:' })).toHaveCount(0)
})

test('a fork from the tab menu resolves to its own session', async () => {
  await labFolder().getByTestId('new-session-button').click()
  await ask('Reply with just the word: parent')
  await expect(h.page.getByTestId('session-title')).not.toContainText('New session', { timeout: 30_000 })

  const tabs = h.page.getByTestId('session-tab-bar')
  await tabs.locator('[role="tab"], .session-tab').last().click({ button: 'right' })
  const fork = h.page.getByRole('menuitem', { name: /fork session/i })
  await expect(fork).toBeEnabled()
  await fork.click()
  // The fork opens in a new tab: wait for it and its terminal before typing, or the first click
  // lands in the moment between the parent's terminal hiding and the fork's appearing.
  await expect(tabs.locator('.session-tab')).toHaveCount(2)
  await expect(terminal()).toBeVisible({ timeout: 30_000 })

  await ask('Reply with just the word: child')
  await expect(activeRows()).toHaveCount(2)
  await expect(activeRows().filter({ hasText: 'new:' })).toHaveCount(0, { timeout: 30_000 })
})



test('renaming in Apiary renames the session in Claude too — what VS Code and /resume read', async () => {
  await labFolder().getByTestId('new-session-button').click()
  await ask('Reply with just the word: named')
  await expect(h.page.getByTestId('session-title')).not.toContainText('New session', { timeout: 30_000 })

  await h.page.getByTestId('session-title-edit').click()
  const input = h.page.getByTestId('session-title-input')
  await input.fill('Renamed from Apiary')
  await input.press('Enter')

  // Claude's own record of the name: its session file, and the custom-title in its transcript.
  await expect.poll(async () => {
    const s = await h.page.evaluate(() => window.apiary.ptySessions())
    return Object.values(s).map((x) => `${x.name ?? ''}|${String(x.nameIsUser)}`)
  }, { timeout: 60_000 }).toContain('Renamed from Apiary|true')
  const titles = labProjectDirs().flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.jsonl'))
    .map((f) => readFileSync(join(d, f), 'utf8'))).join('\n')
  expect(titles).toContain('"customTitle":"Renamed from Apiary"')

  // And the terminal was not left with a stray half-command in it.
  await expect(terminal()).toContainText('Session renamed to: Renamed from Apiary')
})

test('a session made with /fork in the terminal appears in the sidebar', async () => {
  await labFolder().getByTestId('new-session-button').click()
  await ask('Reply with just the word: forkme')
  await expect(h.page.getByTestId('session-title')).not.toContainText('New session', { timeout: 30_000 })
  const rows = labFolder().getByTestId('session-item')
  const before = await rows.count()

  await say('/fork')
  // Claude 2.1.281 starts the fork as a separate session and stays on the original; the fork's
  // transcript is written at once, so it should reach the sidebar on its own.
  await expect.poll(() => rows.count(), { timeout: 45_000 }).toBeGreaterThan(before)
})

