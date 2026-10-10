import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, stays, until } from './helpers'
import type { FakeApiary } from './fakeApiary'
import { emptyChatState, type ChatCommand, type ChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'
import type { TranscriptMessage } from '@shared/domain/transcript'
import type { AppSettingsPayload } from '@shared/api'
import { CHAT_SETTINGS_KEY } from '../../src/renderer/state/uiState'

const TITLE = 'Fix CSV export bug'
const OTHER = 'Add worktree switcher'
const COMMANDS: ChatCommand[] = [
  { name: 'compact', description: 'Compact the conversation', argumentHint: '' },
  { name: 'clear', description: 'Clear the conversation', argumentHint: '' },
]

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
const bodyText = (): string => document.body.textContent ?? ''
const settingValue = (): string | null =>
  document.querySelector('[data-testid="composer-setting-option"] .chat-setting-value')?.textContent ?? null

function rectOf(selector: string): DOMRect {
  const el = document.querySelector(selector)
  if (el === null) throw new Error(`No element matches ${selector}`)
  return el.getBoundingClientRect()
}

function sessionIdOf(fake: FakeApiary, title: string): string {
  const found = fake.state.sessions.find((s) => s.title === title)
  if (found === undefined) throw new Error(`No session titled "${title}"`)
  return found.sessionId
}

function play(fake: FakeApiary, sessionId: string, extra: Partial<ChatState> = {}): void {
  const next: ChatState = { ...emptyChatState(asSessionId(sessionId)), status: 'idle', live: CONVERSATION, ...extra }
  fake.state.chats.set(sessionId, next)
  fake.emit('chatChanged', next)
}

async function openChat(settings: Partial<AppSettingsPayload> = {}): Promise<{ fake: FakeApiary; sessionId: string }> {
  const { fake } = await renderApp({ settings: { transcriptChat: true, ...settings } })
  await userEvent.click(sidebarSession(TITLE))
  await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
  const sessionId = sessionIdOf(fake, TITLE)
  play(fake, sessionId)
  await until(() => bodyText().includes('Two folders.'))
  return { fake, sessionId }
}

async function openPlainTranscript(hideToolCallIo: boolean): Promise<void> {
  await renderApp({
    sessions: [{
      sessionId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      title: 'Plain transcript',
      projectPath: '/fixture/work-a',
      gitBranch: 'main',
      messages: CONVERSATION,
    }],
    settings: { hideToolCallIo },
  })
  await userEvent.click(sidebarSession('Plain transcript'))
}

const openMenu = (): Promise<void> => userEvent.click(page.getByTestId('composer-commands'))

async function flipHideDefault(fake: FakeApiary): Promise<void> {
  fake.emit('openSettingsDialog')
  await until(() => count('settings-dialog') === 1)
  await userEvent.click(page.getByTestId('settings-nav-general'))
  await userEvent.click(page.getByTestId('setting-hide-tool-call-io'))
  await userEvent.click(page.getByTestId('settings-save'))
}

describe('show tool calls', () => {
  it('shows tool calls by default, and the menu row hides them and shows them again', async () => {
    const { fake } = await openChat({})
    expect(count('chat-tool')).toBe(1)

    await openMenu()
    await expect.element(page.getByTestId('composer-setting-option')).toBeVisible()
    expect(settingValue()).toBe('On')

    await userEvent.click(page.getByTestId('composer-setting-option'))
    await until(() => count('chat-tool') === 0)
    expect(settingValue()).toBe('Off')
    // What you said and what Claude said stay.
    expect(document.body.textContent).toContain('list the sources')
    expect(document.body.textContent).toContain('Looking now.')
    expect(document.body.textContent).toContain('Two folders.')

    await userEvent.click(page.getByTestId('composer-setting-option'))
    await until(() => count('chat-tool') === 1)
    expect(fake.callsTo('settingsSet')).toEqual([])
  })

  it('starts hidden when the Settings default says so, and the menu row shows them', async () => {
    await openChat({ hideToolCallIo: true })
    expect(count('chat-tool')).toBe(0)

    await openMenu()
    expect(settingValue()).toBe('Off')
    await userEvent.click(page.getByTestId('composer-setting-option'))
    await until(() => count('chat-tool') === 1)
    expect(settingValue()).toBe('On')
  })

  it('a changed Settings default wins for a chat with no choice of its own', async () => {
    const { fake } = await openChat({})
    expect(count('chat-tool')).toBe(1)

    await flipHideDefault(fake)
    await until(() => count('chat-tool') === 0)
    expect(document.body.textContent).toContain('Two folders.')
  })

  it('a choice made in the chat wins over a changed Settings default', async () => {
    const { fake } = await openChat({})
    await openMenu()
    await userEvent.click(page.getByTestId('composer-setting-option'))
    await until(() => count('chat-tool') === 0)
    await userEvent.click(page.getByTestId('composer-setting-option'))
    await until(() => count('chat-tool') === 1)
    await userEvent.keyboard('{Escape}')

    await flipHideDefault(fake)
    await stays(() => count('chat-tool') === 1, 300, 'the chat keeping its own choice')
  })

  it('the plain transcript follows the same setting, and the messages that held only tool calls go too', async () => {
    await openPlainTranscript(false)
    await until(() => count('message') === 4)
    expect(count('tool-block')).toBe(2)

    await openPlainTranscript(true)
    await until(() => count('message') === 3)
    expect(count('tool-block')).toBe(0)
  })

  it('mid-chat, the menu shows tool calls while Claude is still working, and the chat keeps going', async () => {
    const { fake, sessionId } = await openChat({ hideToolCallIo: true })
    expect(count('chat-tool')).toBe(0)
    play(fake, sessionId, { status: 'busy' })
    await expect.element(page.getByTestId('composer-stop')).toBeVisible()

    await openMenu()
    await userEvent.click(page.getByTestId('composer-setting-option'))
    await until(() => count('chat-tool') === 1)

    await stays(() => count('composer-stop') === 1 && count('chat-tool') === 1, 300, 'the chat still running, with its tool calls shown')
    expect(fake.callsTo('chatInterrupt')).toEqual([])
  })

  it('the menu filters as you type, and the arrow keys, Enter and Escape work on its rows', async () => {
    const { fake, sessionId } = await openChat({})
    expect(count('chat-tool')).toBe(1)
    play(fake, sessionId, { commands: COMMANDS })
    await openMenu()
    const search = page.getByTestId('composer-command-search')
    expect(count('composer-command-option')).toBe(2)

    await userEvent.fill(search, 'show tool')
    expect(count('composer-command-option')).toBe(0)
    expect(count('composer-setting-option')).toBe(1)

    await userEvent.fill(search, '')
    // Chat settings come first, so the first row is the one selected.
    await until(() => document.querySelector('[data-testid="composer-setting-option"]')?.getAttribute('aria-selected') === 'true')

    await userEvent.keyboard('{Enter}')
    await until(() => count('chat-tool') === 0)
    expect(count('composer-command-menu')).toBe(1)

    await userEvent.keyboard('{Escape}')
    await until(() => count('composer-command-menu') === 0)
    await until(() => document.activeElement?.getAttribute('data-testid') === 'composer-commands')
  })

  it('a choice is saved for its chat in the shared store, and a restart keeps it', async () => {
    const { sessionId } = await openChat({})
    await openMenu()
    await userEvent.click(page.getByTestId('composer-setting-option'))
    await until(() => count('chat-tool') === 0)
    await userEvent.keyboard('{Escape}')

    const saved: unknown = JSON.parse(localStorage.getItem(CHAT_SETTINGS_KEY) ?? '{}')
    expect(saved).toEqual({ [sessionId]: { showToolCalls: false } })

    await openChat({})
    expect(count('chat-tool')).toBe(0)
    await openMenu()
    expect(settingValue()).toBe('Off')
  })

  it('the choice belongs to its chat: another chat keeps its own', async () => {
    const { fake } = await openChat({})
    await openMenu()
    await userEvent.click(page.getByTestId('composer-setting-option'))
    await until(() => count('chat-tool') === 0)
    await userEvent.keyboard('{Escape}')

    await userEvent.click(sidebarSession(OTHER))
    play(fake, sessionIdOf(fake, OTHER))
    await until(() => bodyText().includes('Two folders.'))
    expect(count('chat-tool')).toBe(1)
    await openMenu()
    expect(settingValue()).toBe('On')
  })

  it('the menu stays inside a narrow pane on every edge', async () => {
    localStorage.setItem('apiary.ui', JSON.stringify({ sidebarWidth: 1000 }))
    await openChat({})
    await openMenu()
    await expect.element(page.getByTestId('composer-command-menu')).toBeVisible()

    const pane = rectOf('.session-column')
    const menu = rectOf('[data-testid="composer-command-menu"]')
    expect(pane.width).toBeLessThan(560)
    expect(menu.left).toBeGreaterThanOrEqual(pane.left)
    expect(menu.right).toBeLessThanOrEqual(pane.right)
    expect(menu.top).toBeGreaterThanOrEqual(pane.top)
    expect(menu.bottom).toBeLessThanOrEqual(pane.bottom)
  })
})
