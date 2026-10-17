import { test, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApiary, relaunchApiary, importAll, clickRowAction, sidebarSession, type Harness } from '../../tests/e2e/helpers'
import { STARTER_PET } from '../../src/shared/pets/builtins'
import { invoiceStory, syncStory, themeStory } from './stories'

/** Three pets, made by hand rather than by Claude so the picture is the same every time. */
const PETS = [
  { ...STARTER_PET },
  {
    ...STARTER_PET, name: 'Fern',
    body: { shape: 'bean', color: '#6fdc1e', accent: '#e4ff9a', texture: 'fuzzy' },
    eyes: { style: 'round', color: '#0a0a0a' }, arms: 'noodle', legs: 'feet', accessories: [{ kind: 'crown', color: '#ffcc33' }],
  },
  {
    ...STARTER_PET, name: 'Rosie',
    body: { shape: 'heart', color: '#ff1fa8', accent: '#ffa3dc', texture: 'fuzzy' },
    eyes: { style: 'round', color: '#0a0a0a' }, arms: 'mitten', accessories: [{ kind: 'sunglasses', color: '#0b0b0b' }],
  },
]

const FAKE_CLAUDE = join(process.cwd(), 'scripts', 'screenshot', 'fake-claude.sh')

/** The sessions the layout shows, written as Claude Code writes them, in folders of their own. */
const SESSIONS = {
  invoices: { id: 'a1b2c3d4-0001-4a00-8a00-000000000001', folder: 'billing-api', title: 'Fix duplicate invoice emails on webhook retry' },
  theme: { id: 'a1b2c3d4-0002-4a00-8a00-000000000002', folder: 'web-app', title: 'Add a dark mode toggle to settings' },
  sync: { id: 'a1b2c3d4-0003-4a00-8a00-000000000003', folder: 'data-pipeline', title: 'Nightly sync times out on large accounts' },
}

function writeSession(h: Harness, s: { id: string; folder: string; title: string }, lines: string[]): void {
  mkdirSync(join(h.home, s.folder), { recursive: true })
  const dir = join(h.projectsRoot, `-${s.folder}`)
  mkdirSync(dir, { recursive: true })
  const tail = JSON.stringify({ type: 'ai-title', aiTitle: s.title, sessionId: s.id })
  writeFileSync(join(dir, `${s.id}.jsonl`), `${[...lines, tail].join('\n')}\n`)
}

/** What the usage endpoint would answer, for the plugin's stand-in (`APIARY_FAKE_USAGE`): nothing real is read or sent. */
function standInUsage(): string {
  const inHours = (h: number): string => new Date(Date.now() + h * 3_600_000).toISOString()
  return JSON.stringify({ five_hour: { utilization: 42, resets_at: inHours(2.4) }, seven_day: { utilization: 18, resets_at: inHours(80) } })
}

/**
 * A roomy window with the fixture's sessions, three more of ours, the pets and the usage meter.
 * The pets and the meter need the app relaunched to read them, so the fixture is written first.
 */
async function launchShowcase(): Promise<Harness> {
  // The test suite runs the app off-screen so it doesn't take the machine over for minutes at a
  // time; this one is the exception, because a picture of the app is the entire output.
  process.env.APIARY_HEADED = '1'
  const h: Harness = await launchApiary({
    fakeLiveSessionId: '33333333-3333-3333-3333-333333333333', // "Repo root session": the Active dot
    // What a new install looks like: the default theme (Liquid Glass), not the test suite's original look.
    realDefaultTheme: true,
    // One stand-in `claude` for terminal and chat panes alike (fake-claude.sh hands chats on).
    claudeBin: FAKE_CLAUDE,
    settings: { transcriptChat: true, plugins: { 'claude-usage': true } },
  })
  writeSession(h, SESSIONS.invoices, invoiceStory(SESSIONS.invoices.id, join(h.home, SESSIONS.invoices.folder)))
  writeSession(h, SESSIONS.theme, themeStory(SESSIONS.theme.id, join(h.home, SESSIONS.theme.folder)))
  writeSession(h, SESSIONS.sync, syncStory(SESSIONS.sync.id, join(h.home, SESSIONS.sync.folder)))
  // Pets out, standing along the bottom-left. Written straight into the profile — no `claude`
  // call, and `voicedAt` now, so none asks for new lines.
  const userData = await h.app.evaluate(({ app }) => app.getPath('userData'))
  writeFileSync(join(userData, 'pets.json'), JSON.stringify({
    version: 1, enabled: true,
    pets: PETS.map((spec, i) => ({ id: `pet-${String(i)}`, spec, model: 'haiku', size: 92, active: true, place: { region: 'bar', at: 0.04 + i * 0.07 }, createdAt: 0, voicedAt: Date.now() })),
  }))
  await relaunchApiary(h, { APIARY_FAKE_USAGE: standInUsage() })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await h.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1760, 1050) })
  return h
}

/** Opens `titles` in a layout of one large pane and two stacked ones, the first title in the large one. */
async function openLayout(h: Harness, titles: [string, string, string]): Promise<void> {
  await sidebarSession(h.page, titles[0]).click()
  for (const title of titles.slice(1)) {
    await clickRowAction(h.page.locator('.session-row-wrap').filter({ hasText: title }), 'split-session-button')
  }
  await expect(h.page.getByTestId('content')).toHaveAttribute('data-preset', 'main-right2')
}

async function send(column: ReturnType<Harness['page']['getByTestId']>, text: string): Promise<void> {
  await column.getByTestId('composer-input').fill(text)
  await column.getByTestId('composer-input').press('Enter')
}

/**
 * Not a test — a one-off Playwright script that launches the real app against a representative
 * fixture, arranges the UI to show off its main features, and overwrites `docs/screenshot.png`
 * for the README. Run it with `npm run screenshot` whenever a change is significant enough that
 * the README's picture of the app should catch up.
 *
 * It lives here rather than under `tests/e2e/` deliberately: Playwright's config points its
 * default test run at `tests/e2e` (see `playwright.config.ts`), so `npm run test:e2e` never
 * discovers this file, and it asserts nothing anyway — its only job is the PNG it writes.
 */
test('capture the README screenshot', async () => {
  test.setTimeout(300000)
  const h = await launchShowcase()
  await clickRowAction(h.page.locator('.session-row-wrap').filter({ hasText: SESSIONS.invoices.title }), 'pin-session-button')
  await openLayout(h, [SESSIONS.invoices.title, SESSIONS.sync.title, SESSIONS.theme.title])
  const columns = h.page.getByTestId('session-column')
  const [chat, terminal, question] = [columns.nth(0), columns.nth(1), columns.nth(2)]

  // Large pane: a chat in the middle of a long run. The turn it starts never finishes, so the
  // working line keeps counting; the elapsed time is waited for below, not faked.
  await expect(chat.getByTestId('chat-tool').first()).toBeVisible({ timeout: 30000 })
  await send(chat, 'Both are in, thanks. Now run the whole suite and the linter, and fix anything else that breaks.')
  await expect(chat.getByTestId('chat-working')).toBeVisible({ timeout: 30000 })

  // Top right: the session as Claude Code's own terminal.
  await terminal.getByTestId('resume-button').click()
  await expect(terminal.getByTestId('terminal-session')).toContainText('Worked for', { timeout: 20000 })

  // Bottom right: Claude asks one question, then the message box is folded away to leave it room.
  await send(question, 'Make it follow the system setting by default, with a manual override.')
  await expect(question.getByTestId('chat-question')).toBeVisible({ timeout: 30000 })
  // On a short screen the window is smaller than asked for and the card is cut off at the top, under
  // the person's last message, which sticks there: the divider between the two stacked panes moves
  // up by what is missing.
  const stickyMessage = 52
  const cut = (await question.getByTestId('chat-timeline').boundingBox())!.y + stickyMessage - (await question.getByTestId('chat-question-card').boundingBox())!.y
  if (cut > 0) {
    const divider = (await h.page.getByTestId('row-resizer').boundingBox())!
    await h.page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2)
    await h.page.mouse.down()
    await h.page.mouse.move(divider.x + divider.width / 2, divider.y - cut - 12, { steps: 8 })
    await h.page.mouse.up()
  }
  await question.getByTestId('composer-collapse').click()

  // The pets in 3D, not the moment before they are drawn...
  await expect(h.page.locator('.pet-sprite[data-render="3d"]')).toHaveCount(PETS.length, { timeout: 30000 })
  // ...and caught standing apart, not mid-stroll past one another.
  await expect.poll(() => h.page.evaluate(() => {
    const pets = [...document.querySelectorAll('[data-testid="pet"]')]
    if (pets.some((p) => /walk|run/.test(p.querySelector('.pet-sprite')?.getAttribute('data-activity') ?? ''))) return false
    const boxes = pets.map((p) => p.getBoundingClientRect()).sort((a, b) => a.left - b.left)
    return boxes.every((b, i) => i === 0 || b.left >= boxes[i - 1].left + boxes[i - 1].width * 0.9)
  }), { timeout: 90000 }).toBe(true)
  await expect(h.page.getByTestId('status-item-claude-usage-usage')).toContainText('5h 42%')
  // The working line has been counting since the message was sent: wait until it reads over a minute.
  await expect(chat.getByTestId('chat-working')).toContainText(/\d+m \d+s/, { timeout: 120000 })

  // Move the pointer off the panes so no hover card or picker is caught in the picture, and close
  // the Refresh report, which is useful in the app and noise in a README image.
  await h.page.mouse.move(2, 2)
  for (const close of await h.page.getByTestId('notification-close').all()) await close.click()
  await expect(h.page.getByTestId('notification')).toHaveCount(0)

  await h.page.screenshot({ path: join(process.cwd(), 'docs', 'screenshot.png') })
  await h.close()
})
