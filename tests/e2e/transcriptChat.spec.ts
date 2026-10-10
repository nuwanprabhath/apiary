import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'
import { STANDARD_SESSIONS } from '../fixtures/standard'

/**
 * "Run sessions as a chat" through the real app: main spawns `claude` in stream-json mode through
 * a login shell and the transcript draws what it says. `claude` here is
 * tests/fixtures/fake-claude-chat.mjs, which speaks the same protocol as claude 2.1.286 — no
 * tokens are spent.
 */
const FAKE_CLAUDE = fileURLToPath(new URL('../fixtures/fake-claude-chat.mjs', import.meta.url))

let h: Harness

test.beforeEach(async () => {
  h = await launchApiary({ claudeBin: FAKE_CLAUDE, settings: { transcriptChat: true } })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})

test.afterEach(async () => { await h.close() })

test('a message sent from the transcript is answered there, tools and all, without switching to the terminal', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await expect(h.page.getByTestId('chat-timeline')).toBeVisible()

  await h.page.getByTestId('composer-input').fill('hello from the chat')
  await h.page.getByTestId('composer-input').press('Enter')
  await expect(h.page.getByTestId('chat-text').last()).toContainText('You said: hello from the chat')
  await expect(h.page.getByTestId('chat-user').last()).toContainText('hello from the chat')
  // Nothing picked and no Claude settings choosing a mode: it started in Auto, not Manual.
  await expect(h.page.getByTestId('composer-mode')).toHaveAttribute('data-mode', 'auto')

  await h.page.getByTestId('composer-input').fill('this needs permission')
  await h.page.getByTestId('composer-input').press('Enter')
  await expect(h.page.getByTestId('chat-permission')).toContainText('Print a marker')
  await h.page.getByTestId('chat-permission-allow').click()
  const tool = h.page.getByTestId('chat-tool').last()
  await expect(tool).toHaveAttribute('data-status', 'ok')
  await expect(tool.getByTestId('chat-tool-in')).toHaveText('echo fake-ran')
  await expect(tool.getByTestId('chat-tool-out')).toHaveText('fake-ran')
  await expect(h.page.getByTestId('chat-text').last()).toContainText('The command ran.')

  // Never left the transcript, and no terminal was started for it.
  await expect(h.page.getByTestId('view-transcript')).toHaveAttribute('data-active', 'true')
  await expect(h.page.getByTestId('terminal-session')).toHaveCount(0)
})

test('Stop interrupts a reply that is still being written', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('composer-input').fill('go slow please')
  await h.page.getByTestId('composer-input').press('Enter')
  await expect(h.page.getByTestId('chat-working')).toBeVisible()
  await expect(h.page.getByTestId('chat-streaming')).toContainText('word1')
  await h.page.getByTestId('composer-stop').click()
  await expect(h.page.getByTestId('chat-interrupted')).toBeVisible()
  await expect(h.page.getByTestId('composer-send')).toBeVisible()
})

test('the model button shows what claude says it is running, and changes its effort', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('composer-input').fill('hi')
  await h.page.getByTestId('composer-input').press('Enter')
  await expect(h.page.getByTestId('composer-model-pill')).toHaveText(/Fake 1\s*Medium/)
  await h.page.getByTestId('composer-model-pill').click()
  await h.page.getByTestId('composer-effort-high').click()
  await expect(h.page.getByTestId('composer-model-pill')).toHaveText(/Fake 1\s*High/)
  await h.page.getByTestId('composer-model-option').filter({ hasText: 'Fast 2' }).click()
  await expect(h.page.getByTestId('composer-model-pill')).toHaveText('Fast 2')
  await expect(h.page.getByTestId('composer-context')).toBeVisible()
})

test('a session moves from its terminal to the chat and back again', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('resume-button').click()
  await expect(h.page.getByTestId('view-terminal')).toHaveAttribute('data-active', 'true')

  // Sending from the transcript moves it to the chat once the terminal's claude is idle (a busy
  // one keeps the session, and gets the message typed into it): the terminal's claude is stopped.
  await expect.poll(() => h.page.evaluate(
    async (id) => window.apiary.terminalBusy(id),
    STANDARD_SESSIONS.csv.id,
  ), { timeout: 10000 }).toEqual({ busy: false, backgroundTasks: 0 })
  await h.page.getByTestId('view-transcript').click()
  await h.page.getByTestId('composer-input').fill('over to the chat')
  await h.page.getByTestId('composer-input').press('Enter')
  await expect(h.page.getByTestId('chat-text').last()).toContainText('You said: over to the chat')
  await expect(h.page.getByTestId('view-terminal')).toHaveCount(0)

  // And back: the button resumes it in the terminal, which stops the chat.
  await expect(h.page.getByTestId('resume-button')).toHaveAccessibleName('Continue in terminal')
  await h.page.getByTestId('resume-button').click()
  await expect(h.page.getByTestId('view-terminal')).toHaveAttribute('data-active', 'true')
  await expect(h.page.getByTestId('terminal-session')).toBeVisible()
  await expect.poll(() => h.page.evaluate(
    async (id) => (await window.apiary.chatState(id))?.status ?? 'none',
    STANDARD_SESSIONS.csv.id,
  )).toBe('exited')
})

test('the / menu runs Claude\'s commands, and /clear takes the tab on to the new session it starts', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('composer-input').fill('hi')
  await h.page.getByTestId('composer-input').press('Enter')
  await expect(h.page.getByTestId('chat-text').last()).toContainText('You said: hi')

  await h.page.getByTestId('composer-commands').click()
  await h.page.getByTestId('composer-command-search').fill('context')
  await h.page.getByTestId('composer-command-search').press('Enter')
  await expect(h.page.getByTestId('chat-text').last()).toContainText('Context Usage')

  await h.page.getByTestId('composer-commands').click()
  await h.page.getByTestId('composer-command-option').filter({ hasText: '/clear' }).click()
  // The new session's file appears with its first message; the tab follows it there.
  await h.page.getByTestId('composer-input').fill('fresh start')
  await h.page.getByTestId('composer-input').press('Enter')
  await expect(h.page.getByTestId('chat-text').last()).toContainText('You said: fresh start')
  await expect(h.page.getByTestId('session-title')).not.toHaveText('Fix CSV export bug', { timeout: 15000 })
  await expect(h.page.getByTestId('chat-user').last()).toHaveText('fresh start')
})

test('a message sent mid-turn waits as queued and is answered in that turn; a background task shows above the box and its finishing starts a turn', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await expect(h.page.getByTestId('chat-timeline')).toBeVisible()

  await h.page.getByTestId('composer-input').fill('a slow answer please')
  await h.page.getByTestId('composer-input').press('Enter')
  await expect(h.page.getByTestId('chat-streaming')).toContainText('word1')
  await h.page.getByTestId('composer-input').fill('and one more thing')
  await h.page.getByTestId('composer-input').press('Enter')
  await expect(h.page.getByTestId('chat-queued')).toContainText('and one more thing')
  await expect(h.page.getByTestId('chat-text').last()).toContainText('You said: and one more thing', { timeout: 20000 })
  await expect(h.page.getByTestId('chat-queued')).toHaveCount(0)
  await expect(h.page.getByTestId('chat-user').filter({ hasText: 'and one more thing' })).toHaveCount(1)
  await expect(h.page.getByTestId('composer-send')).toBeVisible()

  await h.page.getByTestId('composer-input').fill('run something in the background')
  await h.page.getByTestId('composer-input').press('Enter')
  await expect(h.page.getByTestId('chat-status-tasks')).toContainText('1 background task running')
  // Nothing more is sent: the task finishing starts the next turn, and the line clears.
  await expect(h.page.getByTestId('chat-text').last()).toContainText('The background task finished.')
  await expect(h.page.getByTestId('chat-status-tasks')).toHaveCount(0)
  await expect(h.page.getByTestId('chat-status-turn')).toContainText('for 1s')
})

test('a link clicked in a reply opens in the browser, and the next send still shows the working line', async () => {
  await h.app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { opened: string[] }
    g.opened = []
    shell.openExternal = async (url: string) => { g.opened.push(url) }
  })
  const ticket = 'https://gitlab.com/ternandsparrow/reri/-/work_items/3'

  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('composer-input').fill(`[the ticket](${ticket})`)
  await h.page.getByTestId('composer-input').press('Enter')
  const link = h.page.getByTestId('chat-text').last().getByRole('link', { name: 'the ticket' })
  await expect(link).toBeVisible()
  // `noWaitAfter`: the guard cancels the navigation, so Playwright must not wait for one.
  await link.click({ noWaitAfter: true })
  await expect.poll(() => h.app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)).toEqual([ticket])

  // Playwright's actions wait on the navigation the guard cancelled, so the send goes over the bridge the composer uses.
  await h.page.evaluate(async (id) => { await window.apiary.chatSend(id, 'go slow please') }, STANDARD_SESSIONS.csv.id)
  await expect.poll(() => h.page.evaluate(() => document.querySelector('[data-testid="chat-working"]') !== null)).toBe(true)
})

test('Send now on a queued message interrupts the reply being written, and that message is answered', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('composer-input').fill('go slow please')
  await h.page.getByTestId('composer-input').press('Enter')
  await expect(h.page.getByTestId('chat-streaming')).toContainText('word1')
  await h.page.getByTestId('composer-input').fill('answer this first')
  await h.page.getByTestId('composer-input').press('Enter')
  await expect(h.page.getByTestId('chat-queued')).toContainText('answer this first')
  await h.page.getByTestId('chat-queued-send-btn').click()
  await expect(h.page.getByTestId('chat-text').last()).toContainText('You said: answer this first', { timeout: 20000 })
  await expect(h.page.getByTestId('chat-queued')).toHaveCount(0)
  await expect(h.page.getByTestId('chat-user').filter({ hasText: 'answer this first' })).toHaveCount(1)
  await expect(h.page.getByTestId('composer-send')).toBeVisible()
})
