import { test, expect } from '@playwright/test'
import {
  launchApiary,
  importAll,
  interceptTranscriptPaging,
  releaseHeldTranscriptPaging,
  type Harness,
  sidebarSession,
  expectStays,
} from './helpers'

let h: Harness

test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await sidebarSession(h.page, 'Fix CSV export bug').click()
})

test.afterEach(async () => { await h.close() })

// The tests that once lived here directly (rendering, roles, session switching, the sidechain
// toggle) moved down to tests/component/transcript.test.tsx, which exercises the same behaviour
// against the fake. "paging responses across a session round trip" below stays end-to-end: it
// proves a stale response from a real, superseded IPC call does not corrupt what is on screen —
// a race the fake cannot reproduce without a real asynchronous transport to hold open.

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
    // The stale promise has resolved; watched for long enough to reach the renderer, if it were going to.
    await expectStays(
      async () => (await h.page.getByTestId('message').count()) === 200,
      1000, 'the second visit to keep its own 200 messages',
    )

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
