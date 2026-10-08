import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'
import type { FakeApiary } from './fakeApiary'
import { emptyChatState, type ChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'
import type { TranscriptMessage } from '@shared/domain/transcript'
import type { AppSettingsPayload } from '@shared/api'

/**
 * "Hide tool calls": the Chat tab's switch, and the setting it starts from. A conversation is
 * what you said and what Claude said; the switch leaves out the boxes between them.
 */
const TITLE = 'Fix CSV export bug'

const said = (uuid: string, role: 'user' | 'assistant', blocks: TranscriptMessage['blocks']): TranscriptMessage =>
  ({ uuid, role, timestampMs: null, isSidechain: false, blocks })

const CONVERSATION: TranscriptMessage[] = [
  said('io-u1', 'user', [{ type: 'text', text: 'list the sources' }]),
  said('io-a1', 'assistant', [
    { type: 'text', text: 'Looking now.' },
    { type: 'tool_use', id: 'io1', name: 'Bash', input: { command: 'ls src', description: 'List the sources' } },
  ]),
  said('io-u2', 'user', [{ type: 'tool_result', toolUseId: 'io1', content: 'main\nrenderer', isError: false }]),
  said('io-a2', 'assistant', [{ type: 'text', text: 'Two folders.' }]),
]

const count = (testId: string): number => document.querySelectorAll(`[data-testid="${testId}"]`).length

async function openChat(settings: Partial<AppSettingsPayload>): Promise<FakeApiary> {
  const { fake } = await renderApp({ settings: { transcriptChat: true, ...settings } })
  await userEvent.click(sidebarSession(TITLE))
  await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
  const sessionId = fake.state.sessions.find((s) => s.title === TITLE)!.sessionId
  play(fake, sessionId)
  await until(() => document.body.textContent.includes('Two folders.'))
  return fake
}

function play(fake: FakeApiary, sessionId: string): void {
  const next: ChatState = { ...emptyChatState(asSessionId(sessionId)), status: 'idle', live: CONVERSATION }
  fake.state.chats.set(sessionId, next)
  fake.emit('chatChanged', next)
}

describe('hide tool calls', () => {
  it('shows tool calls by default, and the switch leaves them out and brings them back', async () => {
    await openChat({})
    expect(count('chat-tool')).toBe(1)
    await expect.element(page.getByTestId('tool-io-toggle')).not.toBeChecked()

    await userEvent.click(page.getByTestId('tool-io-toggle'))
    await until(() => count('chat-tool') === 0)
    // What you said and what Claude said stay.
    expect(document.body.textContent).toContain('list the sources')
    expect(document.body.textContent).toContain('Looking now.')
    expect(document.body.textContent).toContain('Two folders.')

    await userEvent.click(page.getByTestId('tool-io-toggle'))
    await until(() => count('chat-tool') === 1)
  })

  it('starts hidden when the setting says so, and the switch can show them for now', async () => {
    await openChat({ hideToolCallIo: true })
    expect(count('chat-tool')).toBe(0)
    await expect.element(page.getByTestId('tool-io-toggle')).toBeChecked()

    await userEvent.click(page.getByTestId('tool-io-toggle'))
    await until(() => count('chat-tool') === 1)
  })

  it('leaves the Settings dialog and the saved setting alone when the switch is used', async () => {
    const { fake } = await renderApp({ settings: { transcriptChat: true } })
    await userEvent.click(sidebarSession(TITLE))
    await userEvent.click(page.getByTestId('tool-io-toggle'))
    expect(fake.callsTo('settingsSet')).toEqual([])
  })

  it('a changed setting wins over an earlier use of the switch', async () => {
    const fake = await openChat({})
    // Hidden by the switch; then the setting is saved as "hide": the saved choice is the new start.
    await userEvent.click(page.getByTestId('tool-io-toggle'))
    await until(() => count('chat-tool') === 0)
    await userEvent.click(page.getByTestId('tool-io-toggle'))
    await until(() => count('chat-tool') === 1)

    fake.emit('openSettingsDialog')
    await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)
    await userEvent.click(page.getByTestId('settings-nav-general'))
    await userEvent.click(page.getByTestId('setting-hide-tool-call-io'))
    await userEvent.click(page.getByTestId('settings-save'))
    await until(() => count('chat-tool') === 0)
    await expect.element(page.getByTestId('tool-io-toggle')).toBeChecked()
  })

  it('hides the tool blocks of the plain transcript too, and the messages that held only those', async () => {
    await renderApp({
      sessions: [{
        sessionId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
        title: 'Plain transcript',
        projectPath: '/fixture/work-a',
        gitBranch: 'main',
        messages: CONVERSATION.map((m) => ({ ...m, timestampMs: Date.now() })),
      }],
    })
    await userEvent.click(sidebarSession('Plain transcript'))
    await until(() => count('message') === 4)
    expect(count('tool-block')).toBe(2)

    await userEvent.click(page.getByTestId('tool-io-toggle'))
    await until(() => count('tool-block') === 0)
    expect(count('message')).toBe(3)
  })
})
