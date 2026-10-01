import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'
import { STANDARD_SESSIONS } from '../fixtures/standard'

/**
 * "Chat in the transcript" through the real app: main spawns `claude` in stream-json mode through
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
  await expect(h.page.getByTestId('chat-sticky-prompt')).toContainText('hello from the chat')

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

  // Sending from the transcript moves it to the chat: the terminal's claude is stopped.
  await h.page.getByTestId('view-transcript').click()
  await h.page.getByTestId('composer-input').fill('over to the chat')
  await h.page.getByTestId('composer-input').press('Enter')
  await expect(h.page.getByTestId('chat-text').last()).toContainText('You said: over to the chat')
  await expect(h.page.getByTestId('view-terminal')).toHaveCount(0)

  // And back: the button resumes it in the terminal, which stops the chat.
  await expect(h.page.getByTestId('resume-button')).toHaveText('Continue in terminal')
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
  await expect(h.page.getByTestId('chat-sticky-prompt')).toHaveText('fresh start')
})
