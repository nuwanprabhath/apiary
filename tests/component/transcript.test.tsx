import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import type { TranscriptMessage, TranscriptPage } from '@shared/types'
import { renderApp } from './renderApp'
import { message, type FakeSession } from './fakeApiary'
import { sidebarSession, until } from './helpers'

describe('transcript', () => {
  it('renders the conversation for the selected session', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await expect.element(page.getByTestId('transcript')).toBeVisible()
    await until(() => page.getByTestId('message').elements().length > 0)
    await expect.element(page.getByTestId('message').elements()[0]).toHaveTextContent('the export is empty')
  })

  it('marks user and assistant messages distinctly', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await until(() => page.getByTestId('message').elements().length > 0)
    const roles = page.getByTestId('message').elements().map((el) => el.getAttribute('data-role'))
    expect(roles).toContain('user')
    expect(roles).toContain('assistant')
  })

  it('switching sessions replaces the transcript', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await until(() => page.getByTestId('message').elements().length > 0)
    await expect.element(page.getByTestId('message').elements()[0]).toHaveTextContent('the export is empty')

    await userEvent.click(sidebarSession('Add worktree switcher'))
    await expect.element(page.getByTestId('session-title')).toHaveTextContent('Add worktree switcher')
    await expect.element(page.getByTestId('transcript')).toBeVisible()
  })

  it('hides sidechain messages until the toggle is switched on', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    const toggle = page.getByTestId('sidechain-toggle')
    await expect.element(toggle).toBeVisible()
    await expect.element(toggle).not.toBeChecked()

    // The fixture session includes a sidechain (subagent) message: verify it is genuinely hidden
    // by default and appears once the toggle is switched on, rather than merely asserting the
    // toggle's own unchecked state (which a broken filter could still pass). Wait for the
    // transcript to actually finish loading first — otherwise "not visible" would trivially pass
    // while the pane is still empty, before the filter ever runs.
    await until(() => page.getByTestId('message').elements().length > 0)
    await expect.element(page.getByText('subagent side note')).not.toBeInTheDocument()
    await userEvent.click(toggle)
    await expect.element(page.getByText('subagent side note')).toBeVisible()
  })

  describe('paging a long session', () => {
    // A dedicated session, long enough (62 messages, over the fake's 50-per-page limit) that
    // "Load earlier messages" is actually offered and a second page is available to fetch. Each
    // pad turn's text embeds its own index (see makeSession, which this mirrors) so a duplicated
    // page shows up as a message whose text is rendered twice, not as two indistinguishable blobs.
    const LONG_SESSION_ID = '55555555-5555-5555-5555-555555555555'
    const longSessionMessages = (): TranscriptMessage[] => {
      const msgs = [message('u0', 'user', 'start of the long session')]
      for (let i = 0; i < 61; i++) msgs.push(message(`a${String(i)}`, 'assistant', `pad-${String(i)} ${'x'.repeat(50)}`))
      return msgs
    }
    const longSession = (): FakeSession => ({
      sessionId: LONG_SESSION_ID,
      title: 'Long paging session',
      projectPath: '/fixture/work-a',
      gitBranch: 'main',
      messages: longSessionMessages(),
    })
    // Mirrors the fake's own 50-per-page slicing (see fakeApiary.ts's `transcript`), so a
    // manually-resolved page here behaves exactly like the fake's real one would.
    const pageOf = (all: TranscriptMessage[], beforeIndex?: number): TranscriptPage => {
      const end = beforeIndex ?? all.length
      const start = Math.max(0, end - 50)
      return { messages: all.slice(start, end), earlierCursor: start > 0 ? start : null, skippedLines: 0 }
    }

    it('"Load earlier messages" appears and loads a distinct earlier page', async () => {
      await renderApp({ sessions: [longSession()] })
      await userEvent.click(sidebarSession('Long paging session'))
      // Initial page holds the most recent 50 of 62 messages, so the very first user message
      // (dropped from the initial page) is not yet on screen.
      await until(() => page.getByTestId('message').elements().length === 50)
      expect(page.getByText('start of the long session', { exact: true }).elements()).toHaveLength(0)

      const button = page.getByTestId('load-earlier')
      await expect.element(button).toBeVisible()
      await userEvent.click(button)

      await until(() => page.getByTestId('message').elements().length === 62)
      expect(page.getByText('start of the long session', { exact: true }).elements()).toHaveLength(1)
      // All 62 messages loaded: nothing earlier remains, so the button disappears.
      await expect.element(button).not.toBeInTheDocument()
    })

    it('button disables itself while a paging fetch is in flight', async () => {
      const { fake } = await renderApp({ sessions: [longSession()] })
      await userEvent.click(sidebarSession('Long paging session'))
      await until(() => page.getByTestId('message').elements().length === 50)

      // Held open until this test releases it — an in-process fetch resolves before Playwright
      // could ever observe the disabled state otherwise.
      let resolveFetch: ((p: TranscriptPage) => void) | null = null
      fake.override('transcript', () => new Promise((resolve) => { resolveFetch = resolve }))

      const button = page.getByTestId('load-earlier')
      await userEvent.click(button)
      // The IPC round trip is asynchronous even for a fast local fetch, so the click handler's
      // synchronous state update (disabling the button) is observable before the response lands.
      await expect.element(button).toBeDisabled()

      // Once the (single, since only one earlier page exists) fetch resolves, the button is
      // removed entirely rather than staying enabled with nothing left to load.
      resolveFetch!(pageOf(longSessionMessages(), 12))
      await expect.element(button).not.toBeInTheDocument()
    })

    it('a second rapid click while a page is in flight does not duplicate messages', async () => {
      const { fake } = await renderApp({ sessions: [longSession()] })
      await userEvent.click(sidebarSession('Long paging session'))
      await until(() => page.getByTestId('message').elements().length === 50)

      let resolveFetch: ((p: TranscriptPage) => void) | null = null
      fake.override('transcript', () => new Promise((resolve) => { resolveFetch = resolve }))

      // Fire both clicks back to back on the raw element, bypassing whatever actionability
      // waiting a locator click would do (which would otherwise itself serialize the clicks by
      // waiting for the button to re-enable) so this exercises the in-flight guard rather than
      // any scheduling of the click itself.
      const button = page.getByTestId('load-earlier').element() as HTMLButtonElement
      button.click()
      button.click()
      resolveFetch!(pageOf(longSessionMessages(), 12))

      await until(() => page.getByTestId('message').elements().length === 62)
      // The earliest message (part of the earlier page) must appear exactly once, not twice — a
      // duplicated fetch would prepend the same page a second time.
      expect(page.getByText('start of the long session', { exact: true }).elements()).toHaveLength(1)
      expect(page.getByText(/^pad-0 /).elements()).toHaveLength(1)
      // Only one fetch was actually dispatched — the second click was a no-op.
      expect(fake.callsTo('transcript').filter((args) => args[1] === 12)).toHaveLength(1)
    })
  })

  describe('markdown rendering', () => {
    // Regression test: MessageRow used to render a text block as a plain <p> with the raw
    // markdown source, so a heading or fenced code block showed up as literal `##`/backtick
    // characters instead of being formatted. Assert on actual rendered structure — a heading
    // element and a <pre><code> block — not just that the text is present somewhere, which a
    // broken plain-text render would also satisfy.
    it('renders headings and fenced code blocks as formatted markdown, not raw source', async () => {
      const md = '## A heading\n\nSome `inline code` and:\n\n```js\nconsole.log(1)\n```\n'
      const session: FakeSession = {
        sessionId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        title: 'Markdown message',
        projectPath: '/fixture/work-a',
        gitBranch: 'main',
        messages: [
          message('u1', 'user', 'show me formatting'),
          { uuid: 'md1', role: 'assistant', timestampMs: Date.now(), isSidechain: false, blocks: [{ type: 'text', text: md }] },
        ],
      }
      await renderApp({ sessions: [session] })
      await userEvent.click(sidebarSession('Markdown message'))
      await until(() => [...document.querySelectorAll<HTMLElement>('[data-testid="message"]')]
        .some((m) => m.textContent?.includes('A heading') === true))
      const found = [...document.querySelectorAll<HTMLElement>('[data-testid="message"]')]
        .find((m) => m.textContent?.includes('A heading') === true)
      if (found === undefined) throw new Error('no message with the heading')

      await expect.element(found.querySelector('h2')!).toHaveTextContent('A heading')
      await expect.element(found.querySelector('p > code')!).toHaveTextContent('inline code')
      await expect.element(found.querySelector('pre code')!).toHaveTextContent('console.log(1)')
      // The raw markdown syntax itself must not leak into the rendered text.
      expect(found.textContent).not.toContain('##')
      expect(found.textContent).not.toContain('```')
    })
  })

  describe('tool block chevron', () => {
    // Regression test: the chevron used to be the row's last flex child with no spacer of its
    // own — `.tool-preview` (flex: 1) was the only thing pushing it to the right edge, and that
    // element is removed entirely once the block expands (there is no preview text once the full
    // payload is showing). With nothing left to push against, the chevron collapsed back to sit
    // immediately after the tool name instead of staying in a fixed place, reading as a visible
    // jump to the left on every expand/collapse.
    it('the expand chevron stays in the same place when a tool block is expanded', async () => {
      const session: FakeSession = {
        sessionId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        title: 'Tool block session',
        projectPath: '/fixture/work-a',
        gitBranch: 'main',
        messages: [
          message('u1', 'user', 'read a file'),
          {
            uuid: 'tool1',
            role: 'assistant',
            timestampMs: Date.now(),
            isSidechain: false,
            blocks: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x.ts' } }],
          },
        ],
      }
      await renderApp({ sessions: [session] })
      await userEvent.click(sidebarSession('Tool block session'))
      await until(() => document.querySelector('.tool-head') !== null)
      const head = document.querySelector<HTMLElement>('.tool-head')!
      const chevron = head.querySelector<HTMLElement>('.chevron')!
      await expect.element(chevron).toBeVisible()

      const before = chevron.getBoundingClientRect()
      await userEvent.click(head)
      await until(() => document.querySelector('.tool-body') !== null)
      const after = chevron.getBoundingClientRect()

      expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1)
    })
  })
})
