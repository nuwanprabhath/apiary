import { asSessionId } from '@shared/domain/ids'
import { describe, it, expect } from 'vitest'
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
}

function harness(opts: { failFirst?: boolean } = {}): Harness {
  const scans: Array<() => void> = []
  let passes = 0
  let disposed = false
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
    detectLive: async () => live,
    isDisposed: () => disposed,
    updateSearchIndex: async () => {},
  })
  return { catalog, scans, passes: () => passes, setDisposed: () => { disposed = true }, live }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

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
