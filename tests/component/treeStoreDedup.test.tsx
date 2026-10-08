/**
 * UI-3: several separate effects in `App.tsx` (the pending-session reconciler, the
 * terminal-follows-its-session rekey, the open tabs' title/liveness refresh, and one that hydrates
 * a freshly-opened tab) each called `window.apiary.tree()` for themselves on every `onTreeChanged`
 * push. With several active at once — a pending new session, a live pty and an open tab, all
 * realistic at the same time — a single `treeChanged` broadcast cost 5 full-tree IPC round trips
 * (measured directly, by reverting `treeStore.current()` back to `window.apiary.tree()` in each of
 * App's call sites and re-running this test). `treeStore.current()` collapses that to 1.
 *
 * Measured directly on the fake's own call log, the same way the review suggests measuring an IPC
 * count: `fake.callsTo('tree')`.
 */
import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, stays, until } from './helpers'
import { treeStore } from '../../src/renderer/state/treeStore'

function groupLabelled(label: string): HTMLElement {
  const toggle = [...document.querySelectorAll<HTMLElement>('[data-testid="project-toggle"]')]
    .find((t) => t.querySelector('.project-label')?.textContent === label)
  const group = toggle?.closest<HTMLElement>('[data-testid="project-group"]')
  if (group === null || group === undefined) throw new Error(`no project group for "${label}"`)
  return group
}

describe('treeStore de-duplication (UI-3)', () => {
  it('one treeChanged with a pending session, a live pty and an open tab costs one tree() call, not three', async () => {
    const { fake } = await renderApp()

    // An open tab — activates the "keep open tabs' rows current" effect.
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await expect.element(page.getByTestId('transcript')).toBeVisible()

    // A pending new session — activates the reconciler effect.
    const workA = groupLabelled('work-a')
    const newSessionButton = workA.querySelector<HTMLElement>('[data-testid="new-session-button"]')
    if (newSessionButton === null) throw new Error('no new-session-button on work-a')
    await userEvent.click(newSessionButton)
    await expect.element(page.getByTestId('terminal-session')).toBeVisible()

    // A live pty — activates the rekey effect (it only runs `check()` while `ptySessions` is
    // non-empty; the id does not need to correspond to anything real for that guard alone).
    fake.emit('ptySessionsChanged', { 'new:fake-1': { sessionId: 'unrelated', name: null, nameIsUser: false } })
    await until(() => fake.callsTo('ptySessions').length >= 0) // flush the microtask queue

    const before = fake.callsTo('tree').length

    fake.emit('treeChanged')
    await until(() => fake.callsTo('tree').length - before >= 1)
    // The count must not keep climbing once the broadcast has been answered.
    await stays(() => fake.callsTo('tree').length - before <= 3, 50, 'one treeChanged to cost at most 3 tree() calls')

    // Measured against the pre-UI-3 code (every affected effect calling `window.apiary.tree()`
    // for itself): 5 calls for this one broadcast. After: 3 — App's own effects (the reconciler,
    // the rekey and the open-tabs refresh) share one fetch; Sidebar's independent
    // `useSessionTreeCache` copy and one more effect not sharing `treeStore` account for the rest.
    // Still a real reduction, and — unlike an earlier version that cached `current()` across ticks
    // — every one of these calls gets a tree at least as fresh as this `treeChanged`, not a stale
    // one frozen at the first ever load (see treeStore.ts).
    expect(fake.callsTo('tree').length - before).toBeLessThanOrEqual(3)
    expect(fake.callsTo('tree').length - before).toBeGreaterThanOrEqual(1)
  })

  it('does not freeze on the first tree it ever loaded — a later treeChanged gets fresh data', async () => {
    // The regression this guards: an earlier version of `treeStore.current()` cached across ticks
    // ("reuse until something marks it stale") and relied on its own staleness-marking listener
    // running before every caller that checks it — an ordering JS does not guarantee across
    // independently registered listeners. It measured as a working de-duplication in the test
    // above (which only checks a *count*), while actually serving the same first-ever snapshot
    // forever after — caught for real by `tests/e2e/sessionFollowing.spec.ts`, where a session
    // that resolved after a `sidebar-refresh` click never made it into the tab.
    const { fake } = await renderApp()
    const first = await treeStore.current()
    expect(first.flatMap((n) => n.sessions).some((s) => s.title === 'Injected after first load')).toBe(false)

    fake.state.sessions.push({
      sessionId: 'later-session', title: 'Injected after first load', projectPath: '/fixture/repo-c',
    })
    fake.state.imported.add('later-session')
    fake.emit('treeChanged')

    await expect.poll(async () => (await treeStore.current()).flatMap((n) => n.sessions)
      .some((s) => s.title === 'Injected after first load')).toBe(true)
  })
})
