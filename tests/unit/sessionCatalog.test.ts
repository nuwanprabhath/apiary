import { asSessionId } from '@shared/domain/ids'
import { describe, it, expect, vi } from 'vitest'
import { WorktreeResolver } from '../../src/main/git/worktreeResolver'
import { SessionCatalog } from '../../src/main/sessions/sessionCatalog'
import type { SessionStore } from '../../src/main/store/sessionStore'
import type { SessionSource } from '../../src/main/sources/claudeProjects'

/** A store that knows nothing, so a pass resolves no folders and spawns no processes. */
function fakeStore(): SessionStore {
  return {
    fileStamps: () => new Map(),
    distinctCwds: () => [],
    syncAll: () => {},
    allSessions: () => [],
    getSession: () => null,
  } as unknown as SessionStore
}

interface Harness {
  catalog: SessionCatalog
  scans: Array<() => void>
  passes: () => number
  setDisposed: () => void
  live: Map<string, number>
  detects: () => number
  liveChanged: () => number
}

function harness(opts: { failFirst?: boolean; liveMinIntervalMs?: number } = {}): Harness {
  const scans: Array<() => void> = []
  let passes = 0
  let disposed = false
  let detects = 0
  let liveChanged = 0
  const live = new Map<string, number>()
  const source = {
    scan: () => {
      passes += 1
      const n = passes
      return new Promise((resolve, reject) => {
        scans.push(() => (opts.failFirst && n === 1 ? reject(new Error('boom')) : resolve([])))
      })
    },
  } as unknown as SessionSource
  const catalog = new SessionCatalog({
    store: fakeStore(),
    source,
    worktrees: new WorktreeResolver({ exec: async () => { throw new Error('no git in this test') } }),
    detectLive: async () => { detects += 1; return new Map(live) },
    liveMinIntervalMs: opts.liveMinIntervalMs,
    onLiveChanged: () => { liveChanged += 1 },
    isDisposed: () => disposed,
    updateSearchIndex: async () => {},
  })
  return {
    catalog, scans, passes: () => passes, setDisposed: () => { disposed = true }, live,
    detects: () => detects, liveChanged: () => liveChanged,
  }
}

/** One turn of the event loop, so queued promise work has run; no clock involved. */
const tick = (): Promise<void> => new Promise((r) => { setImmediate(r) })

describe('SessionCatalog refresh state machine', () => {
  it('joins a refresh requested mid-pass and runs exactly one rerun for all joiners', async () => {
    const h = harness()
    const a = h.catalog.refresh()
    await tick()
    const b = h.catalog.refresh()
    const c = h.catalog.refresh()
    expect(h.passes()).toBe(1) // running: nobody started a second pass
    h.scans[0]()
    await tick()
    expect(h.passes()).toBe(2) // rerun-queued -> one chained pass, not two
    h.scans[1]()
    await Promise.all([a, b, c])
    expect(h.passes()).toBe(2)
  })

  it('returns to idle: a refresh after completion starts a fresh pass', async () => {
    const h = harness()
    const a = h.catalog.refresh()
    await tick()
    h.scans[0]()
    await a
    const b = h.catalog.refresh()
    await tick()
    expect(h.passes()).toBe(2)
    h.scans[1]()
    await b
  })

  it('a failed pass rejects its awaiters, drops the queued rerun and does not wedge the next refresh', async () => {
    const h = harness({ failFirst: true })
    const a = h.catalog.refresh()
    await tick()
    const b = h.catalog.refresh() // queues a rerun that must be dropped
    h.scans[0]()
    await expect(a).rejects.toThrow('boom')
    await expect(b).rejects.toThrow('boom')
    expect(h.passes()).toBe(1)
    const c = h.catalog.refresh()
    await tick()
    h.scans[1]()
    await c
    expect(h.passes()).toBe(2)
  })

  it('schedules no rerun once disposed, and whenIdle resolves after the in-flight pass', async () => {
    const h = harness()
    const a = h.catalog.refresh()
    await tick()
    void h.catalog.refresh()
    h.setDisposed()
    const idle = h.catalog.whenIdle()
    h.scans[0]()
    await Promise.all([a, idle])
    expect(h.passes()).toBe(1)
  })

  it('whenIdle never rejects, even when the pass failed', async () => {
    const h = harness({ failFirst: true })
    const a = h.catalog.refresh().catch(() => {})
    await tick()
    const idle = h.catalog.whenIdle()
    h.scans[0]()
    await expect(idle).resolves.toBeUndefined()
    await a
  })
})

describe('SessionCatalog live map', () => {
  it('is replaced wholesale at the end of a pass and read through isLive/checkConflict', async () => {
    const h = harness()
    expect(h.catalog.isLive('s1')).toBe(false)
    expect(await h.catalog.checkConflict(asSessionId('s1'))).toBeNull()
    h.live.set('s1', 4242)
    const p = h.catalog.refresh()
    await tick()
    h.scans[0]()
    await p
    expect(h.catalog.isLive('s1')).toBe(true)
    expect(await h.catalog.checkConflict(asSessionId('s1'))).toEqual({ sessionId: asSessionId('s1'), pid: 4242 })
  })
})

describe('SessionCatalog live-session detection is throttled (MAIN-1)', () => {
  // A scoped pass never reads these files (they do not exist); it only reaches the live step.
  const scoped = ['/x/a.jsonl']

  it('runs one process scan for any number of scoped passes inside the window', async () => {
    const h = harness({ liveMinIntervalMs: 60_000 })
    for (let i = 0; i < 6; i += 1) await h.catalog.refresh({ paths: scoped })
    expect(h.detects()).toBe(1)
  })

  it('a full pass always scans, whatever the window says', async () => {
    const h = harness({ liveMinIntervalMs: 60_000 })
    await h.catalog.refresh({ paths: scoped })
    const full = h.catalog.refresh()
    await vi.waitFor(() => { expect(h.scans).toHaveLength(1) })
    h.scans[0]()
    await full
    expect(h.detects()).toBe(2)
  })

  it('a session that starts inside the window still turns live when the window ends, and the tree is told', async () => {
    const h = harness({ liveMinIntervalMs: 40 })
    await h.catalog.refresh({ paths: scoped })
    h.live.set('11111111-1111-4111-8111-111111111111', 4242)
    await h.catalog.refresh({ paths: scoped }) // inside the window: no scan yet
    expect(h.detects()).toBe(1)
    expect(h.catalog.isLive('11111111-1111-4111-8111-111111111111')).toBe(false)

    await vi.waitFor(() => { expect(h.catalog.isLive('11111111-1111-4111-8111-111111111111')).toBe(true) })
    expect(h.detects()).toBe(2)
    expect(h.liveChanged()).toBe(1)
  })

  it('the follow-up scan is one per window however many passes asked for it, and says nothing when nothing changed', async () => {
    const h = harness({ liveMinIntervalMs: 40 })
    await h.catalog.refresh({ paths: scoped })
    for (let i = 0; i < 5; i += 1) await h.catalog.refresh({ paths: scoped })
    await vi.waitFor(() => { expect(h.detects()).toBe(2) })
    expect(h.liveChanged()).toBe(0)
  })
})
