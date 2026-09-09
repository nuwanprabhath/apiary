import { test, expect } from '@playwright/test'
import {
  launchApiary,
  importAll,
  interceptTranscriptPaging,
  releaseHeldTranscriptPaging,
  type Harness,
  sidebarSession,
} from './helpers'
import { makeSession } from '../fixtures/makeSession'

let h: Harness
test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await sidebarSession(h.page, 'Fix CSV export bug').click()
})
test.afterEach(async () => { await h.close() })

test('renders the conversation for the selected session', async () => {
  await expect(h.page.getByTestId('transcript')).toBeVisible()
  await expect(h.page.getByTestId('message').first()).toContainText('the export is empty')
})

test('marks user and assistant messages distinctly', async () => {
  await expect(h.page.getByTestId('message').first()).toBeVisible()
  const roles = await h.page.getByTestId('message').evaluateAll(
    (nodes) => nodes.map((n) => n.getAttribute('data-role')),
  )
  expect(roles).toContain('user')
  expect(roles).toContain('assistant')
})

test('switching sessions replaces the transcript', async () => {
  await expect(h.page.getByTestId('message').first()).toContainText('the export is empty')
  await sidebarSession(h.page, 'Add worktree switcher').click()
  await expect(h.page.getByTestId('session-title')).toHaveText('Add worktree switcher')
  await expect(h.page.getByTestId('transcript')).toBeVisible()
})

test('hides sidechain messages until the toggle is switched on', async () => {
  const toggle = h.page.getByTestId('sidechain-toggle')
  await expect(toggle).toBeVisible()
  await expect(toggle).not.toBeChecked()

  // The fixture session includes a sidechain (subagent) message: verify it is genuinely
  // hidden by default and appears once the toggle is switched on, rather than merely
  // asserting the toggle's own unchecked state (which a broken filter could still pass).
  // Wait for the transcript to actually finish loading first — otherwise "not visible"
  // would trivially pass while the pane is still empty, before the filter ever runs.
  await expect(h.page.getByTestId('message').first()).toBeVisible()
  await expect(h.page.getByText('subagent side note')).not.toBeVisible()
  await toggle.check()
  await expect(h.page.getByText('subagent side note')).toBeVisible()
})

test.describe('paging a long session', () => {
  // A dedicated session, long enough (252 messages, over the 200-per-page limit) that
  // "Load earlier messages" is actually offered and a second page is available to fetch.
  // Each pad turn's text embeds its own index (see makeSession) so a duplicated page shows up
  // as a message whose text is rendered twice, not as two indistinguishable blobs.
  //
  // This session must exist before the app launches: "Refresh" in the UI only re-fetches the
  // tree from whatever the store already holds, it does not rescan disk (that happens via the
  // filesystem watcher's debounced rescan, which is not deterministic to wait on in a test) —
  // so the outer `beforeEach`'s harness (launched with just the standard four sessions) is
  // replaced here with a fresh one seeded with this fifth session from the start, the same way
  // the standard four are.
  test.beforeEach(async () => {
    await h.close()
    h = await launchApiary({
      extraSessions: [{
        slug: '-work-long',
        sessionId: '55555555-5555-5555-5555-555555555555',
        title: 'Long paging session',
        firstPrompt: 'start of the long session',
        padTurns: 250,
      }],
    })
    await importAll(h.page)
    await h.page.getByTestId('sidebar-refresh').click()
    await sidebarSession(h.page, 'Long paging session').click()
    await expect(h.page.getByTestId('session-title')).toHaveText('Long paging session')
    await expect(h.page.getByTestId('message').first()).toBeVisible()
  })

  test('"Load earlier messages" appears and loads a distinct earlier page', async () => {
    // Initial page holds the most recent 200 of 252 messages, so the very first user
    // message (dropped from the initial page) is not yet on screen.
    await expect(h.page.getByTestId('message')).toHaveCount(200)
    await expect(h.page.getByText('start of the long session')).toHaveCount(0)

    const button = h.page.getByTestId('load-earlier')
    await expect(button).toBeVisible()
    await button.click()

    await expect(h.page.getByTestId('message')).toHaveCount(252)
    await expect(h.page.getByText('start of the long session')).toHaveCount(1)
    // All 252 messages loaded: nothing earlier remains, so the button disappears.
    await expect(button).toHaveCount(0)
  })

  test('button disables itself while a paging fetch is in flight', async () => {
    const button = h.page.getByTestId('load-earlier')
    await button.click()
    // The IPC round trip is asynchronous even for a fast local fetch, so the click handler's
    // synchronous state update (disabling the button) is observable before the response lands.
    await expect(button).toBeDisabled()
    // Once the (single, since only one earlier page exists) fetch resolves, the button is
    // removed entirely rather than staying enabled with nothing left to load.
    await expect(button).toHaveCount(0)
  })

  test('a second rapid click while a page is in flight does not duplicate messages', async () => {
    const button = h.page.getByTestId('load-earlier')
    await expect(button).toBeVisible()

    // Fire both clicks back to back, bypassing Playwright's actionability wait (which would
    // otherwise itself serialize the clicks by waiting for the button to re-enable) so this
    // exercises the in-flight guard rather than Playwright's own click scheduling.
    await Promise.all([
      button.click({ force: true }),
      button.click({ force: true }),
    ])

    await expect(h.page.getByTestId('message')).toHaveCount(252)
    // The earliest message (part of the earlier page) must appear exactly once, not twice —
    // a duplicated fetch would prepend the same page a second time.
    await expect(h.page.getByText('start of the long session')).toHaveCount(1)
    await expect(h.page.getByText(/^pad-0 /)).toHaveCount(1)
  })
})

test.describe('paging responses across a session round trip', () => {
  // Same long-session fixture as above, seeded before launch for the same reason (see the
  // comment on the describe block above). This block additionally intercepts the main-process
  // `apiary:transcript` IPC handler (see helpers.ts) so a paging response can be held open on
  // demand — something no amount of clicking in a real, fast, in-process file read could ever
  // reproduce deterministically.
  test.beforeEach(async () => {
    await h.close()
    h = await launchApiary({
      extraSessions: [{
        slug: '-work-long',
        sessionId: '55555555-5555-5555-5555-555555555555',
        title: 'Long paging session',
        firstPrompt: 'start of the long session',
        padTurns: 250,
      }],
    })
    await importAll(h.page)
    await h.page.getByTestId('sidebar-refresh').click()
  })

  test('A -> B -> A: a stale paging response from the first visit does not corrupt the second visit', async () => {
    await interceptTranscriptPaging(h.app, { kind: 'hold' })

    // First visit to the long session (A). Initial load passes through normally.
    await sidebarSession(h.page, 'Long paging session').click()
    await expect(h.page.getByTestId('session-title')).toHaveText('Long paging session')
    await expect(h.page.getByTestId('message')).toHaveCount(200)

    // Click "Load earlier" — this paging request is now held open by the intercept and will
    // not resolve until the test releases it, below.
    await h.page.getByTestId('load-earlier').click()
    await expect(h.page.getByTestId('load-earlier')).toBeDisabled()

    // Switch to session B. Its own initial load passes through the intercept untouched.
    await sidebarSession(h.page, 'Add worktree switcher').click()
    await expect(h.page.getByTestId('session-title')).toHaveText('Add worktree switcher')

    // Switch back to A *before* the held response resolves: a second, fresh visit to the same
    // session id. The effect resets messages/cursor and reloads the initial 200-message page.
    await sidebarSession(h.page, 'Long paging session').click()
    await expect(h.page.getByTestId('session-title')).toHaveText('Long paging session')
    await expect(h.page.getByTestId('message')).toHaveCount(200)

    // Now release the first visit's stale paging response.
    await releaseHeldTranscriptPaging(h.app)
    // Give the (now-resolved) stale promise a moment to reach the renderer, if it were going to.
    await h.page.waitForTimeout(500)

    // The second visit must be untouched by the stale response: still exactly the fresh
    // 200-message initial page, no duplication, and "Load earlier" still reflects the second
    // visit's own cursor rather than having been overwritten (or removed) by the first visit's
    // response.
    await expect(h.page.getByTestId('message')).toHaveCount(200)
    await expect(h.page.getByText('start of the long session')).toHaveCount(0)
    const button = h.page.getByTestId('load-earlier')
    await expect(button).toBeVisible()
    await expect(button).toBeEnabled()

    // Confirm the second visit's own cursor genuinely still works: clicking it now loads the
    // remaining 52 messages exactly once, with no leftover duplication from the stale response.
    // Switch the intercept back to passthrough first — otherwise this click's own paging
    // request would itself be held open by the still-active 'hold' behavior.
    await interceptTranscriptPaging(h.app, { kind: 'passthrough' })
    await button.click()
    await expect(h.page.getByTestId('message')).toHaveCount(252)
    await expect(h.page.getByText('start of the long session')).toHaveCount(1)
    await expect(h.page.getByText(/^pad-0 /)).toHaveCount(1)
    await expect(button).toHaveCount(0)
  })

  test('a rejected paging fetch surfaces an error and does not permanently wedge paging', async () => {
    await interceptTranscriptPaging(h.app, { kind: 'reject', message: 'simulated paging failure' })

    await sidebarSession(h.page, 'Long paging session').click()
    await expect(h.page.getByTestId('message')).toHaveCount(200)

    await h.page.getByTestId('load-earlier').click()

    const error = h.page.getByTestId('transcript-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('simulated paging failure')

    // Recovery: restore normal paging behavior, then navigate away and back. If the in-flight
    // guard (`loadingEarlierRef`/`loadingEarlier`) had not been cleared by `.finally` on the
    // rejected request, or if it leaked across the session switch, "Load earlier" would come
    // back stuck disabled and unusable forever for this session.
    await interceptTranscriptPaging(h.app, { kind: 'passthrough' })
    await sidebarSession(h.page, 'Add worktree switcher').click()
    await expect(h.page.getByTestId('session-title')).toHaveText('Add worktree switcher')
    await sidebarSession(h.page, 'Long paging session').click()
    await expect(h.page.getByTestId('session-title')).toHaveText('Long paging session')
    await expect(h.page.getByTestId('message')).toHaveCount(200)

    const button = h.page.getByTestId('load-earlier')
    await expect(button).toBeVisible()
    await expect(button).toBeEnabled()

    // Paging genuinely works again, not merely "looks enabled": the click actually completes.
    await button.click()
    await expect(h.page.getByTestId('message')).toHaveCount(252)
    await expect(button).toHaveCount(0)
  })
})

test.describe('markdown rendering', () => {
  // Reuses the shared outer `h` binding (closing and replacing it, the same pattern the other
  // nested describes above use) rather than shadowing it with a new local one — a second,
  // concurrently-running Electron instance left over from the outer `beforeEach` is not just
  // wasteful but can starve the one this describe actually needs, since the fixture session
  // must exist on disk before the app launches (see the comment on "paging a long session"'s
  // own `beforeEach` above): a post-launch rescan-and-import round trip works too (proven by
  // the other tests in this file that add sessions mid-test), but only reliably as the sole
  // Electron instance running.
  test.beforeEach(async () => {
    await h.close()
    h = await launchApiary()
    makeSession(h.projectsRoot, '-work-a-md', {
      sessionId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      cwd: h.workdir,
      title: 'Markdown message',
      extraLines: [JSON.stringify({
        sessionId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        cwd: h.workdir,
        gitBranch: 'main',
        isSidechain: false,
        version: '2.1.246',
        type: 'assistant',
        uuid: 'md1',
        timestamp: '2026-09-01T10:02:00.000Z',
        message: {
          role: 'assistant',
          content: [{
            type: 'text',
            text: '## A heading\n\nSome `inline code` and:\n\n```js\nconsole.log(1)\n```\n',
          }],
        },
      })],
    })
    // The fixture file above is written after the app's own startup scan, so a rescan must
    // happen before `importAll`'s `discovered()` query can see it at all.
    // "Refresh" fires the rescan and returns immediately (see Sidebar.tsx's fire-and-forget
    // click handler) — `importAll`'s `discovered()` query must not race ahead of it, so wait for
    // the fixture's title to actually become clickable (a polling assertion, unlike a bare
    // `.click()`) before treating the rescan as done, both here and after the second refresh.
    await h.page.getByTestId('sidebar-refresh').click()
    await expect.poll(async () => {
      const discovered = await h.page.evaluate(() => window.apiary.discovered())
      return discovered.some((s) => s.title === 'Markdown message')
    }).toBe(true)
    await importAll(h.page)
    await h.page.getByTestId('sidebar-refresh').click()
    await expect(sidebarSession(h.page, 'Markdown message')).toBeVisible()
    await sidebarSession(h.page, 'Markdown message').click()
  })

  // Regression test: MessageRow used to render a text block as a plain <p> with the raw
  // markdown source, so a heading or fenced code block showed up as literal `##`/backtick
  // characters instead of being formatted. Assert on actual rendered structure — a heading
  // element and a <pre><code> block — not just that the text is present somewhere, which a
  // broken plain-text render would also satisfy.
  test('renders headings and fenced code blocks as formatted markdown, not raw source', async () => {
    const message = h.page.getByTestId('message').filter({ hasText: 'A heading' })
    await expect(message.locator('h2')).toHaveText('A heading')
    await expect(message.locator('p > code')).toContainText('inline code')
    await expect(message.locator('pre code')).toContainText('console.log(1)')
    // The raw markdown syntax itself must not leak into the rendered text.
    await expect(message).not.toContainText('##')
    await expect(message).not.toContainText('```')
  })
})

test.describe('tool block chevron', () => {
  // Reuses the shared outer `h` binding — same pattern as the "markdown rendering" describe
  // above (see its comment for why: a second concurrent Electron instance left over from the
  // outer beforeEach can starve the one this describe actually needs).
  test.beforeEach(async () => {
    await h.close()
    h = await launchApiary()
    makeSession(h.projectsRoot, '-work-a-tool', {
      sessionId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      cwd: h.workdir,
      title: 'Tool block session',
      extraLines: [JSON.stringify({
        sessionId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        cwd: h.workdir,
        gitBranch: 'main',
        isSidechain: false,
        version: '2.1.246',
        type: 'assistant',
        uuid: 'tool1',
        timestamp: '2026-09-01T10:02:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x.ts' } }],
        },
      })],
    })
    await h.page.getByTestId('sidebar-refresh').click()
    await expect.poll(async () => {
      const discovered = await h.page.evaluate(() => window.apiary.discovered())
      return discovered.some((s) => s.title === 'Tool block session')
    }).toBe(true)
    await importAll(h.page)
    await h.page.getByTestId('sidebar-refresh').click()
    await expect(sidebarSession(h.page, 'Tool block session')).toBeVisible()
    await sidebarSession(h.page, 'Tool block session').click()
  })

  // Regression test: the chevron used to be the row's last flex child with no spacer of its
  // own — `.tool-preview` (flex: 1) was the only thing pushing it to the right edge, and that
  // element is removed entirely once the block expands (there is no preview text once the full
  // payload is showing). With nothing left to push against, the chevron collapsed back to sit
  // immediately after the tool name instead of staying in a fixed place, reading as a visible
  // jump to the left on every expand/collapse.
  test('the expand chevron stays in the same place when a tool block is expanded', async () => {
    const head = h.page.locator('.tool-head').first()
    const chevron = head.locator('.chevron')
    await expect(chevron).toBeVisible()

    const before = await chevron.boundingBox()
    if (before === null) throw new Error('chevron has no bounding box before expanding')

    await head.click()
    await expect(h.page.locator('.tool-body')).toBeVisible()

    const after = await chevron.boundingBox()
    if (after === null) throw new Error('chevron has no bounding box after expanding')

    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1)
  })
})
