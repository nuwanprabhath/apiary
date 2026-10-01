import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'
import type { FakeApiary } from './fakeApiary'
import { emptyChatState, type ChatState } from '../../src/shared/domain/chat'
import type { TranscriptMessage } from '../../src/shared/domain/transcript'

/**
 * The "Chat in the transcript" setting: the transcript drawn the way the VS Code extension draws a
 * conversation, and the message box driving the session as a chat. Claude's side is played by the
 * test through `chatChanged`, as main's ChatManager would send it.
 */
const TITLE = 'Fix CSV export bug'

async function openChat(): Promise<{ fake: FakeApiary; sessionId: string }> {
  const { fake } = await renderApp({ settings: { transcriptChat: true } })
  await userEvent.click(sidebarSession(TITLE))
  await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
  const sessionId = fake.state.sessions.find((s) => s.title === TITLE)!.sessionId
  return { fake, sessionId }
}

const said = (uuid: string, role: 'user' | 'assistant', blocks: TranscriptMessage['blocks']): TranscriptMessage =>
  ({ uuid, role, timestampMs: null, isSidechain: false, blocks })

/** The text of the first element with `testId` (or the last, with `last`), polled until it matches. */
async function textOf(testId: string, expected: string | RegExp, last = false): Promise<void> {
  await expect.poll(() => {
    const all = document.querySelectorAll(`[data-testid="${testId}"]`)
    return (last ? all[all.length - 1] : all[0])?.textContent ?? ''
  }).toMatch(expected)
}

function play(fake: FakeApiary, sessionId: string, patch: Partial<ChatState>): void {
  const next = { ...(fake.state.chats.get(sessionId) ?? { ...emptyChatState(sessionId), status: 'idle' as const }), ...patch }
  fake.state.chats.set(sessionId, next)
  fake.emit('chatChanged', next)
}

describe('transcript chat', () => {
  it('sending starts the session as a chat and stays on the transcript, with Stop while Claude works', async () => {
    const { fake, sessionId } = await openChat()
    await userEvent.fill(page.getByTestId('composer-input'), 'add a test')
    await userEvent.keyboard('{Enter}')

    await until(() => fake.callsTo('chatSend').length === 1)
    expect(fake.callsTo('chatStart')).toEqual([[sessionId, { takeOver: true }]])
    expect(fake.callsTo('chatSend')).toEqual([[sessionId, 'add a test']])
    expect(fake.callsTo('sendPrompt')).toEqual([])
    // Still the transcript: nothing switched to the terminal.
    await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
    await expect.element(page.getByTestId('composer-stop')).toBeVisible()

    await userEvent.click(page.getByTestId('composer-stop'))
    await until(() => fake.callsTo('chatInterrupt').length === 1)
  })

  it('streams the reply as it is written, under a working line, and keeps your last message at the top', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, {
      status: 'busy',
      turnStartedAt: Date.now() - 3000,
      live: [said('live-u1', 'user', [{ type: 'text', text: 'explain the parser' }])],
      streaming: { text: 'The parser reads', thinking: false, thinkingSince: null, thinkingTokens: null },
    })
    await expect.element(page.getByTestId('chat-working')).toBeVisible()
    await textOf('chat-streaming', 'The parser reads')
    await textOf('chat-working', /…/)
    await textOf('chat-working', /esc to interrupt/)
    await textOf('chat-sticky-prompt', 'explain the parser')
  })

  it('shows a tool call with its input and output together, and how long Claude thought', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, {
      live: [
        said('t-think', 'assistant', [{ type: 'thinking', text: '' }]),
        said('t-call', 'assistant', [{ type: 'tool_use', id: 'x1', name: 'Bash', input: { command: 'ls src', description: 'List the sources' } }]),
        said('t-res', 'user', [{ type: 'tool_result', toolUseId: 'x1', content: 'main\nrenderer', isError: false }]),
      ],
      thoughts: { 't-think': { seconds: 3, tokens: 512 } },
    })
    const tool = page.getByTestId('chat-tool')
    await expect.element(tool).toHaveAttribute('data-status', 'ok')
    await textOf('chat-tool', 'List the sources')
    await textOf('chat-tool-in', 'ls src')
    await textOf('chat-tool-out', /main\s*renderer/)
    await textOf('chat-thought', 'Thought for 3s · 512 tokens', true)
  })

  it('a permission prompt is answered from the conversation', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, {
      status: 'busy',
      permissions: [{ requestId: 'p1', toolName: 'Bash', description: 'Delete the build', input: { command: 'rm -rf out' }, canAlwaysAllow: true }],
    })
    await textOf('chat-permission', 'Delete the build')
    await textOf('chat-permission', 'rm -rf out')
    await userEvent.click(page.getByTestId('chat-permission-deny'))
    await userEvent.fill(page.getByTestId('chat-permission-reason'), 'keep it')
    await userEvent.click(page.getByTestId('chat-permission-deny-send'))
    await until(() => fake.callsTo('chatRespond').length === 1)
    expect(fake.callsTo('chatRespond')).toEqual([[sessionId, 'p1', { behavior: 'deny', message: 'keep it' }]])
    await expect.element(page.getByTestId('chat-permission')).not.toBeInTheDocument()
  })

  it('the permission mode can be chosen, and reaches a running chat', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, { status: 'idle', permissionMode: 'default' })
    await expect.element(page.getByTestId('composer-mode')).toHaveAttribute('data-mode', 'manual')
    await userEvent.click(page.getByTestId('composer-mode'))
    await textOf('composer-mode-menu', /Claude will explore the code and present a plan/)
    await userEvent.click(page.getByTestId('composer-mode-plan'))
    await until(() => fake.callsTo('chatSetPermissionMode').length === 1)
    expect(fake.callsTo('chatSetPermissionMode')).toEqual([[sessionId, 'plan']])
  })

  it('the model button names the model really running, and changes model and effort', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, {
      status: 'idle',
      model: 'claude-haiku-4-5-20251001',
      effort: null,
      contextUsed: 42327,
      contextWindow: 200000,
      models: [
        { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: 'Opus 5.5', efforts: ['low', 'medium', 'high'] },
        { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: 'For complex work', efforts: ['low', 'medium', 'high'] },
        { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', description: 'Fastest', efforts: [] },
      ],
    })
    await textOf('composer-model-pill', /^Haiku 4\.5$/)
    await textOf('composer-context', '21')

    await userEvent.click(page.getByTestId('composer-model-pill'))
    await expect.element(page.getByTestId('composer-model-menu')).toBeVisible()
    // Haiku has no effort levels, so there is no scale to show.
    await expect.element(page.getByTestId('composer-effort')).not.toBeInTheDocument()
    await userEvent.click(page.getByTestId('composer-model-option').nth(1))
    await until(() => fake.callsTo('chatSetModel').length === 1)
    expect(fake.callsTo('chatSetModel')).toEqual([[sessionId, 'opus']])

    play(fake, sessionId, { model: 'claude-opus-5-5', effort: 'medium' })
    await textOf('composer-model-pill', /Opus 5\.5\s*Medium/)
    await userEvent.click(page.getByTestId('composer-model-pill'))
    await userEvent.click(page.getByTestId('composer-effort-high'))
    await until(() => fake.callsTo('chatSetEffort').length === 1)
    expect(fake.callsTo('chatSetEffort')).toEqual([[sessionId, 'high']])
  })

  it('the / menu searches Claude\'s commands, runs one that takes nothing and fills in one that takes arguments', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, {
      status: 'idle',
      commands: [
        { name: 'clear', description: 'Clear conversation history', argumentHint: '' },
        { name: 'compact', description: 'Clear history but keep a summary', argumentHint: '<instructions>' },
        { name: 'context', description: 'Show current context usage', argumentHint: '' },
      ],
    })
    await userEvent.click(page.getByTestId('composer-commands'))
    await userEvent.fill(page.getByTestId('composer-command-search'), 'cont')
    await expect.poll(() => [...document.querySelectorAll('[data-testid="composer-command-option"]')].map((e) => e.getAttribute('data-name')))
      .toEqual(['context'])
    await userEvent.keyboard('{Enter}')
    await until(() => fake.callsTo('chatSend').length === 1)
    expect(fake.callsTo('chatSend')).toEqual([[sessionId, '/context']])

    await userEvent.click(page.getByTestId('composer-commands'))
    await userEvent.fill(page.getByTestId('composer-command-search'), 'compact')
    await userEvent.click(page.getByTestId('composer-command-option').first())
    await expect.element(page.getByTestId('composer-input')).toHaveValue('/compact ')
    expect(fake.callsTo('chatSend')).toHaveLength(1)
  })
})
