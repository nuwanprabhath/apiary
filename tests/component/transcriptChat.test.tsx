import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { drag, sidebarSession, until } from './helpers'
import type { FakeApiary } from './fakeApiary'
import { emptyChatState, type ChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'
import type { TranscriptMessage } from '@shared/domain/transcript'

/**
 * The "Run sessions as a chat" setting: the transcript drawn the way the VS Code extension draws a
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
  const next = { ...(fake.state.chats.get(sessionId) ?? { ...emptyChatState(asSessionId(sessionId)), status: 'idle' as const }), ...patch }
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

  it('streams the reply as it is written, under a working line', async () => {
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
    // Your message is on screen, so it is not pinned above itself as well.
    expect(document.querySelector('[data-testid="chat-sticky-prompt"]')).toBeNull()
  })

  it('pins your last message once it scrolls out above, and going back to it lands it in view', async () => {
    const { fake, sessionId } = await openChat()
    const long = Array.from({ length: 80 }, (_, i) => `line ${String(i)}`).join('\n\n')
    play(fake, sessionId, {
      live: [
        said('pin-u1', 'user', [{ type: 'text', text: 'explain the parser' }]),
        said('pin-a1', 'assistant', [{ type: 'text', text: long }]),
      ],
    })
    await textOf('chat-text', 'line 79', true)
    const scroller = document.querySelector<HTMLElement>('[data-testid="transcript"]')!
    scroller.scrollTop = scroller.scrollHeight
    await textOf('chat-sticky-prompt', 'explain the parser')
    await userEvent.click(page.getByTestId('chat-sticky-prompt'))
    // Back at the message: it is in view, below where the pin was, and the pin has gone.
    await expect.poll(() => document.querySelector('[data-testid="chat-sticky-prompt"]')).toBeNull()
    // (Polled: the scroll there is smooth, and the pin goes as soon as the message peeks in.)
    await expect.poll(() => document.querySelector('[data-key="pin-u1"]')!.getBoundingClientRect().top - scroller.getBoundingClientRect().top)
      .toBeGreaterThanOrEqual(0)
  })

  it('shows the first three lines of a tool\'s input and output, and all of it on request', async () => {
    const { fake, sessionId } = await openChat()
    const out = Array.from({ length: 12 }, (_, i) => `row ${String(i)}`).join('\n')
    play(fake, sessionId, {
      live: [
        said('clip-call', 'assistant', [{ type: 'tool_use', id: 'c1', name: 'Bash', input: { command: 'cat <<EOF\none\ntwo\nthree\nfour\nEOF', description: 'Heredoc' } }]),
        said('clip-res', 'user', [{ type: 'tool_result', toolUseId: 'c1', content: out, isError: false }]),
      ],
    })
    await textOf('chat-tool-out', /row 2/)
    expect(document.querySelector('[data-testid="chat-tool-out"]')!.textContent).not.toContain('row 3')
    expect(document.querySelector('[data-testid="chat-tool-in"]')!.textContent).not.toContain('three')
    await textOf('chat-tool-out-more', 'Show all 12 lines')
    await userEvent.click(page.getByTestId('chat-tool-out-more'))
    await textOf('chat-tool-out', /row 11/)
    // Clicking a clipped box opens it too.
    await userEvent.click(page.getByTestId('chat-tool-in'))
    await textOf('chat-tool-in', /four/)
  })

  it('a message sent while Claude works shows as queued until Claude takes it in', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, { status: 'busy', turnStartedAt: Date.now(), queued: [{ id: 'q1', text: 'and lint too', sentAt: Date.now() }] })
    await textOf('chat-queued', /and lint too\s*Queued/)
    play(fake, sessionId, { queued: [], live: [said('q-sent', 'user', [{ type: 'text', text: 'and lint too' }])] })
    await expect.poll(() => document.querySelector('[data-testid="chat-queued"]')).toBeNull()
    await textOf('chat-user', 'and lint too', true)
  })

  it('a sent message shows once when the session file has it before claude replays it', async () => {
    const { fake, sessionId } = await openChat()
    const sentAt = Date.now()
    play(fake, sessionId, { status: 'busy', turnStartedAt: sentAt, queued: [{ id: 'q1', text: 'and lint too', sentAt }] })
    await textOf('chat-queued', /and lint too\s*Queued/)
    // Claude has written it to the file; its replay is still to come.
    const session = fake.state.sessions.find((s) => s.sessionId === sessionId)!
    session.messages = [...(session.messages ?? []), { ...said('q-sent', 'user', [{ type: 'text', text: 'and lint too' }]), timestampMs: sentAt + 50 }]
    fake.emit('treeChanged')
    await textOf('chat-user', 'and lint too', true)
    expect(document.querySelector('[data-testid="chat-queued"]')).toBeNull()
  })

  it('a background task reporting back is a quiet notice, and the line above the box says what is still running and how the last turn went', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, {
      live: [said('n1', 'user', [{ type: 'text', text: '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>Background command "Build" completed (exit code 0)</summary>\n</task-notification>' }])],
      backgroundTasks: [{ taskId: 'b2', description: 'Run the e2e suite' }],
      lastTurn: { durationMs: 33000, endedAt: Date.parse('2026-10-02T09:23:00') },
    })
    await textOf('chat-notice', 'Background command "Build" completed (exit code 0)')
    await textOf('chat-status-tasks', /1 background task running · Run the e2e suite/)
    await textOf('chat-status-turn', /for 33s · done 9:23/)
    // While Claude works, the working line says so instead.
    play(fake, sessionId, { status: 'busy', turnStartedAt: Date.now() })
    await expect.poll(() => document.querySelector('[data-testid="chat-status-turn"]')).toBeNull()
  })

  it('reading further up is not interrupted by new content arriving; Jump to latest goes back down', async () => {
    const { fake, sessionId } = await openChat()
    const long = Array.from({ length: 120 }, (_, i) => `para ${String(i)}`).join('\n\n')
    play(fake, sessionId, { status: 'busy', turnStartedAt: Date.now(), live: [said('s-a1', 'assistant', [{ type: 'text', text: long }])] })
    await textOf('chat-text', 'para 119', true)
    const scroller = document.querySelector<HTMLElement>('[data-testid="transcript"]')!
    await expect.poll(() => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight).toBeLessThan(5)
    // A small upward scroll — one trackpad step — is enough to stop following.
    scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, bubbles: true }))
    scroller.scrollTop -= 10
    scroller.dispatchEvent(new Event('scroll'))
    const reading = scroller.scrollTop
    for (let i = 0; i < 5; i++) {
      play(fake, sessionId, { streaming: { text: `more ${String(i)} `.repeat(40), thinking: false, thinkingSince: null, thinkingTokens: null } })
      await textOf('chat-streaming', `more ${String(i)}`)
    }
    expect(scroller.scrollTop).toBe(reading)
    scroller.scrollTop = 0
    scroller.dispatchEvent(new Event('scroll'))
    await userEvent.click(page.getByTestId('transcript-jump'))
    await expect.poll(() => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight).toBeLessThan(5)
  })

  it('a message typed while the session works in its terminal goes to that terminal, not stopping it', async () => {
    const { fake, sessionId } = await openChat()
    await userEvent.click(page.getByTestId('resume-button'))
    await userEvent.click(page.getByTestId('view-transcript'))
    fake.state.terminalBusy.set(sessionId, { busy: false, backgroundTasks: 1 })
    await userEvent.fill(page.getByTestId('composer-input'), 'how is it going?')
    await userEvent.keyboard('{Enter}')
    await until(() => fake.callsTo('sendPrompt').length === 1)
    expect(fake.callsTo('sendPrompt')[0][1]).toBe('how is it going?')
    expect(fake.callsTo('chatStart')).toEqual([])
    await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
    // Nothing running there any more: now the chat takes it over.
    fake.state.terminalBusy.set(sessionId, { busy: false, backgroundTasks: 0 })
    await userEvent.fill(page.getByTestId('composer-input'), 'carry on')
    await userEvent.keyboard('{Enter}')
    await until(() => fake.callsTo('chatSend').length === 1)
    expect(fake.callsTo('chatStart')).toEqual([[sessionId, { takeOver: true }]])
  })

  it('Continue in terminal waits for the chat to finish what it is doing, unless asked to switch now', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, { status: 'busy', turnStartedAt: Date.now(), backgroundTasks: [] })
    await userEvent.click(page.getByTestId('resume-button'))
    await textOf('resume-handoff', /after Claude to finish/)
    expect(fake.callsTo('resume')).toEqual([])
    play(fake, sessionId, { status: 'idle', turnStartedAt: null, backgroundTasks: [{ taskId: 'b1', description: 'Build' }] })
    await textOf('resume-handoff', /after 1 background task/)
    expect(fake.callsTo('resume')).toEqual([])
    play(fake, sessionId, { backgroundTasks: [] })
    await until(() => fake.callsTo('resume').length === 1)
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

  it('a permission prompt arriving while you type does not take the keyboard: Enter still sends your message, not Yes', async () => {
    const { fake, sessionId } = await openChat()
    await userEvent.fill(page.getByTestId('composer-input'), 'and then run the tests')
    const composer = page.getByTestId('composer-input').element()
    expect(document.activeElement).toBe(composer)

    play(fake, sessionId, {
      status: 'busy',
      permissions: [{ requestId: 'p1', toolName: 'Bash', description: 'Delete the build', input: { command: 'rm -rf out' }, canAlwaysAllow: false }],
    })
    await textOf('chat-permission', 'Delete the build')
    expect(document.activeElement).toBe(composer)

    await userEvent.keyboard('{Enter}')
    await until(() => fake.callsTo('chatSend').length === 1)
    expect(fake.callsTo('chatSend')).toEqual([[sessionId, 'and then run the tests']])
    expect(fake.callsTo('chatRespond')).toEqual([])
    await expect.element(page.getByTestId('chat-permission')).toBeVisible()
  })

  it('a permission prompt arriving while nothing is being typed takes focus, so Enter allows from the keyboard', async () => {
    const { fake, sessionId } = await openChat()
    ;(document.activeElement as HTMLElement | null)?.blur()
    play(fake, sessionId, {
      status: 'busy',
      permissions: [{ requestId: 'p1', toolName: 'Bash', description: 'Delete the build', input: { command: 'rm -rf out' }, canAlwaysAllow: false }],
    })
    await textOf('chat-permission', 'Delete the build')
    await expect.poll(() => document.activeElement).toBe(page.getByTestId('chat-permission-allow').element())
    await userEvent.keyboard('{Enter}')
    await until(() => fake.callsTo('chatRespond').length === 1)
    expect(fake.callsTo('chatRespond')).toEqual([[sessionId, 'p1', { behavior: 'allow' }]])
  })

  it('the working line announces that Claude is working once; its ticking time is not in the live region', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, { status: 'busy', turnStartedAt: Date.now() - 3000 })
    await expect.element(page.getByTestId('chat-working')).toBeVisible()
    const working = document.querySelector('[data-testid="chat-working"]')!
    const announced = (): string => [working, ...working.querySelectorAll('*')].filter((n) => n.matches('[role="status"], [aria-live]')).map((n) => n.textContent).join('|')
    const shown = (): string => working.querySelector('.chat-working-detail')?.textContent ?? ''

    const before = { announced: announced(), shown: shown() }
    expect(before.announced).toMatch(/working/i)
    expect(before.announced).not.toMatch(/\d/)
    // Let the clock tick over (and the verb along with it): the screen reader hears nothing new.
    await expect.poll(shown, { timeout: 4000 }).not.toBe(before.shown)
    expect(announced()).toBe(before.announced)
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

  it('UI-26: the mode menu is a keyboard menu — focus on open, arrows and Home/End, Escape returns focus to its button', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, { status: 'idle', permissionMode: 'default' })
    const button = page.getByTestId('composer-mode')
    await userEvent.click(button)
    const focusedId = (): string | null => document.activeElement?.getAttribute('data-testid') ?? null
    expect(focusedId()).toBe('composer-mode-manual')
    await userEvent.keyboard('{ArrowDown}')
    expect(focusedId()).toBe('composer-mode-acceptEdits')
    await userEvent.keyboard('{End}')
    expect(focusedId()).toBe('composer-mode-auto')
    await userEvent.keyboard('{ArrowDown}')
    expect(focusedId()).toBe('composer-mode-manual')
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByTestId('composer-mode-menu')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(button.element())
  })

  it('UI-26: the model menu reaches the effort scale by keyboard too', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, {
      status: 'idle',
      model: 'claude-opus-5-5',
      effort: 'medium',
      models: [{ value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: '', efforts: ['low', 'medium', 'high'] }],
    })
    await userEvent.click(page.getByTestId('composer-model-pill'))
    const focusedId = (): string | null => document.activeElement?.getAttribute('data-testid') ?? null
    expect(focusedId()).toBe('composer-model-option')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(focusedId()).toBe('composer-effort-high')
    await userEvent.keyboard('{Enter}')
    await until(() => fake.callsTo('chatSetEffort').length === 1)
    expect(fake.callsTo('chatSetEffort')).toEqual([[sessionId, 'high']])
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

  it('UI-26: the / menu is a labelled dialog whose search drives aria-activedescendant through the listed commands', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, {
      status: 'idle',
      commands: [
        { name: 'clear', description: 'Clear conversation history', argumentHint: '' },
        { name: 'compact', description: 'Clear history but keep a summary', argumentHint: '<instructions>' },
      ],
    })
    await userEvent.click(page.getByTestId('composer-commands'))
    const menu = page.getByTestId('composer-command-menu').element()
    expect(menu.getAttribute('role')).toBe('dialog')
    expect(menu.getAttribute('aria-label')).toBe('Slash commands')
    const search = page.getByTestId('composer-command-search').element()
    const options = [...document.querySelectorAll('[data-testid="composer-command-option"]')]
    expect(search.getAttribute('aria-activedescendant')).toBe(options[0].id)
    await userEvent.keyboard('{ArrowDown}')
    expect(search.getAttribute('aria-activedescendant')).toBe(options[1].id)
    expect(options[1].getAttribute('aria-selected')).toBe('true')
    // Esc closes the popup and the "/" button gets the focus back.
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByTestId('composer-command-menu')).not.toBeInTheDocument()
    await expect.poll(() => document.activeElement).toBe(page.getByTestId('composer-commands').element())
  })

  it('the model button keeps its name on one line, however little room the row has', async () => {
    await openChat()
    const pill = document.querySelector<HTMLElement>('[data-testid="composer-model-pill"]')!
    await expect.poll(() => pill.textContent).toBe('Default model')
    // One line: as tall as any other small control, not two lines of text spilling out of it.
    const name = pill.querySelector('.chat-model-name')!.getBoundingClientRect()
    expect(name.height).toBeLessThan(pill.getBoundingClientRect().height)
    expect(pill.scrollWidth).toBeLessThanOrEqual(pill.clientWidth)
  })

  it('the message box grows with what is typed, and its top edge drags it taller', async () => {
    await openChat()
    const input = document.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]')!
    const empty = input.getBoundingClientRect().height
    await userEvent.fill(page.getByTestId('composer-input'), Array.from({ length: 8 }, (_, i) => `line ${String(i)}`).join('\n'))
    // All eight lines show, without scrolling inside the box.
    await expect.poll(() => input.getBoundingClientRect().height).toBeGreaterThan(empty)
    expect(input.scrollHeight).toBeLessThanOrEqual(input.clientHeight + 2)
    const grown = input.getBoundingClientRect().height
    await drag(document.querySelector('[data-testid="composer-resize"]')!, 0, -120)
    await expect.poll(() => input.getBoundingClientRect().height).toBeGreaterThan(grown + 60)
  })

  it('lays a list out as densely as the extension: one line per item, nested lists included', async () => {
    const { fake, sessionId } = await openChat()
    const reply = '1. **grill-with-docs**\n   - Enhanced version of grill-me\n   - Also generates CONTEXT.md\n2. **diagnose**\n   - Disciplined bug diagnosis loop\n   - Good for hard bugs'
    play(fake, sessionId, { live: [said('dense-a1', 'assistant', [{ type: 'text', text: reply }])] })
    await textOf('chat-text', 'Good for hard bugs', true)
    const list = document.querySelector('[data-testid="chat-text"]:last-of-type .markdown ol')!
    const lineHeight = parseFloat(getComputedStyle(list).lineHeight)
    // Six lines of text, with a little room between items — not a blank line after every one.
    expect(list.getBoundingClientRect().height).toBeLessThan(6 * lineHeight * 1.25)
  })

  it('the / button is the size of the context ring beside it, and the box\'s top edge has the grip every resizable edge has', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, { contextUsed: 42000, contextWindow: 200000 })
    await expect.element(page.getByTestId('composer-context')).toBeVisible()
    const ring = document.querySelector('[data-testid="composer-context"]')!.getBoundingClientRect()
    const slash = document.querySelector('[data-testid="composer-commands"]')!.getBoundingClientRect()
    expect([slash.width, slash.height]).toEqual([ring.width, ring.height])
    const grip = getComputedStyle(document.querySelector('[data-testid="composer-resize"]')!, '::after')
    expect(grip.backgroundImage).toContain('radial-gradient')
  })

  it('the grip sits in the gap between the panel\'s top line and the message box, not on the line', async () => {
    await openChat()
    const composer = document.querySelector('[data-testid="composer"]')!.getBoundingClientRect()
    const input = document.querySelector('[data-testid="composer-input"]')!.getBoundingClientRect()
    const handle = document.querySelector('[data-testid="composer-resize"]')!.getBoundingClientRect()
    // The dots are centred in the handle (`::after`, translate -50%), so the handle's middle is theirs.
    const dots = handle.top + handle.height / 2
    const gapTop = composer.top + 1 // below the 1px top border
    expect(Math.abs(dots - (gapTop + input.top) / 2)).toBeLessThanOrEqual(1)
  })

  it('attaches the session its pane shows once however many readers it has, and lets go when the tab goes', async () => {
    const { fake, sessionId } = await openChat()
    // The header and the body both read the chat; main holds one attachment per window and session.
    expect(fake.callsTo('chatAttach')).toEqual([[sessionId]])
    expect(fake.callsTo('chatDetach')).toEqual([])
    await userEvent.click(page.getByTestId('session-tab-close').first())
    await until(() => fake.callsTo('chatDetach').length === 1)
    expect(fake.callsTo('chatDetach')).toEqual([[sessionId]])
  })
})
