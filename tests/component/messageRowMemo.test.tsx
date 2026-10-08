/**
 * UI-4 step 3: `MessageRow` had no `React.memo`, so it re-rendered on every App-level state change
 * — including the ~500ms-coalesced `activeTabsChanged` broadcast that fires while any pty is
 * printing — even when its own `message` and `onOpenImage` props had not changed at all.
 *
 * `summarise()` inside `MessageRow` runs `JSON.stringify(input, null, 2)` once per `tool_use`
 * block, on every render of the row that holds it (MessageRow.tsx). That is a real, observable
 * side effect of the row actually re-rendering, so counting those calls — rather than trying to
 * peek inside React's memo bailout — is what this test measures: it is the same technique as
 * counting IPC calls on the fake, applied to a render instead of a fetch.
 *
 * The second test covers UI-8's `ToolUseBlock`: `memo(MessageRow)` alone cannot help when the row
 * re-renders for its *own* reason (`showThinking` toggling on a sibling block in the same
 * message) — that is a real state change on the row itself, so the whole `MessageRow` re-renders
 * regardless of memo, and only a memo boundary *inside* it, around the tool_use block specifically,
 * can stop `summarise` from re-running for a block whose `input` did not change.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { message } from './fakeApiary'
import { nextFrames, sidebarSession, until } from './helpers'

describe('MessageRow memoisation (UI-4 step 3)', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('does not re-summarise a tool_use block when an unrelated App state change re-renders it', async () => {
    const { fake } = await renderApp({
      sessions: [{
        sessionId: 'tool-msg',
        title: 'Tool call session',
        projectPath: '/fixture/repo-c',
        messages: [
          message('u1', 'user', 'run the build'),
          message('a1', 'assistant', 'building', {
            blocks: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm run build' } }],
          }),
        ],
      }],
    })
    await userEvent.click(sidebarSession('Tool call session'))
    await until(() => page.getByTestId('message').elements().length > 0)
    // The tool block reads its own detail from `summarise`, so its presence confirms the
    // JSON.stringify calls we are about to count come from the row we intend to measure.
    await expect.element(page.getByTestId('tool-block')).toBeVisible()

    // The exact call `summarise()` makes: `JSON.stringify(input, null, 2)`. `mergeLatestPage`
    // elsewhere also calls `JSON.stringify`, but always with one argument, so filtering on the
    // 3-argument form isolates the row's own work.
    let summariseCalls = 0
    const realStringify = JSON.stringify.bind(JSON)
    vi.spyOn(JSON, 'stringify').mockImplementation((v: unknown, replacer?: unknown, space?: unknown) => {
      if (replacer === null && space === 2) summariseCalls++
      return realStringify(v, replacer as never, space as never)
    })

    // Force ten App-level re-renders the same way the app's own ~500ms activity broadcast does,
    // without touching this session's messages or the `onOpenImage` callback at all.
    for (let i = 0; i < 10; i++) {
      fake.state.tabs = [{
        windowNumber: 1, key: `probe-${i}`, view: 'transcript', status: i % 2 === 0 ? 'idle' : 'running', label: null,
      }]
      fake.emit('activeTabsChanged')
      await nextFrames(1)
    }

    // Measured against the pre-memo MessageRow (temporarily unwrapping `memo()`): 7 re-summarise
    // calls for the same 10 broadcasts (some coalesce into one React commit). After `memo()`: 0 —
    // the row bails out before `summarise` ever runs again.
    expect(summariseCalls).toBe(0)
  })

  it('does not re-summarise a tool_use block when a sibling thinking block toggles in the same message (UI-8)', async () => {
    await renderApp({
      sessions: [{
        sessionId: 'tool-and-thinking',
        title: 'Tool and thinking session',
        projectPath: '/fixture/repo-c',
        messages: [
          message('u1', 'user', 'run the build'),
          message('a1', 'assistant', 'building', {
            blocks: [
              { type: 'thinking', text: 'considering the build command' },
              { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm run build' } },
            ],
          }),
        ],
      }],
    })
    await userEvent.click(sidebarSession('Tool and thinking session'))
    await expect.element(page.getByTestId('tool-block')).toBeVisible()
    await expect.element(page.getByTestId('thinking-block')).toBeVisible()

    let summariseCalls = 0
    const realStringify = JSON.stringify.bind(JSON)
    vi.spyOn(JSON, 'stringify').mockImplementation((v: unknown, replacer?: unknown, space?: unknown) => {
      if (replacer === null && space === 2) summariseCalls++
      return realStringify(v, replacer as never, space as never)
    })

    // Toggling "Show thinking" is a state change on the message row itself, so the row does
    // re-render — this is not testing `memo(MessageRow)`, it is testing `ToolUseBlock`'s own memo.
    const toggle = page.getByText('Show thinking')
    await userEvent.click(toggle)
    await userEvent.click(page.getByText('Hide thinking'))

    // Measured with `ToolUseBlock`'s `useMemo` removed (calling `summarise` inline instead): 2 —
    // once per toggle, even though `input` never changed. After: 0.
    expect(summariseCalls).toBe(0)
  })
})
