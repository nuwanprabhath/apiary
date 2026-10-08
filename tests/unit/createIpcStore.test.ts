import { describe, it, expect } from 'vitest'
import { createIpcStore, createKeyedIpcStore } from '../../src/renderer/state/createIpcStore'

/** A promise the test settles by hand, so "the fetch resolves after the push" is a statement, not a race. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const flush = (): Promise<void> => new Promise((r) => { queueMicrotask(r) })

/** A fake bridge: a counted push subscription plus a fetch the test controls. */
function harness<T>(initial: T) {
  let bridge = { id: 1 }
  const calls = { fetch: 0, subscribe: 0, unsubscribe: 0 }
  const fetches: ReturnType<typeof deferred<T>>[] = []
  let push: ((v: T) => void) | null = null
  let invalidate: (() => void) | null = null
  const options = {
    scope: 'app' as const,
    initial,
    bridge: () => bridge,
    onError: () => {},
    fetch: (): Promise<T> => {
      calls.fetch += 1
      const d = deferred<T>()
      fetches.push(d)
      return d.promise
    },
    subscribe: (p: (v: T) => void, inv: () => void): (() => void) => {
      calls.subscribe += 1
      push = p
      invalidate = inv
      return () => { calls.unsubscribe += 1; push = null; invalidate = null }
    },
  }
  return {
    calls, fetches, options,
    push: (v: T) => { push?.(v) },
    invalidate: () => { invalidate?.() },
    swapBridge: () => { bridge = { id: bridge.id + 1 } },
  }
}

describe('createIpcStore', () => {
  it('a push that lands before the initial fetch resolves wins over the older fetched value', async () => {
    const h = harness<string | null>(null)
    const store = createIpcStore(h.options)
    const off = store.subscribe(() => {})
    h.push('pushed')
    h.fetches[0].resolve('fetched-earlier')
    await flush()
    expect(store.getSnapshot()).toBe('pushed')
    off()
  })

  it('a fetch that resolves with no push in between is applied', async () => {
    const h = harness<string | null>(null)
    const store = createIpcStore(h.options)
    const off = store.subscribe(() => {})
    h.fetches[0].resolve('fetched')
    await flush()
    expect(store.getSnapshot()).toBe('fetched')
    expect(store.isLoaded()).toBe(true)
    off()
  })

  it('N subscribers share one subscription and one fetch', async () => {
    const h = harness<number>(0)
    const store = createIpcStore(h.options)
    const offs = [1, 2, 3, 4, 5].map(() => store.subscribe(() => {}))
    expect(h.calls.subscribe).toBe(1)
    expect(h.calls.fetch).toBe(1)
    h.fetches[0].resolve(7)
    await flush()
    expect(store.getSnapshot()).toBe(7)
    offs.slice(0, 4).forEach((off) => { off() })
    expect(h.calls.unsubscribe).toBe(0)
    offs[4]()
    expect(h.calls.unsubscribe).toBe(1)
  })

  it('unwires the push when the last subscriber leaves, and re-reads when one returns', async () => {
    const h = harness<number>(0)
    const store = createIpcStore(h.options)
    store.subscribe(() => {})()
    expect(h.calls.unsubscribe).toBe(1)
    h.fetches[0].resolve(1)
    await flush()
    const off = store.subscribe(() => {})
    expect(h.calls.subscribe).toBe(2)
    expect(h.calls.fetch).toBe(2)
    expect(store.getSnapshot()).toBe(1) // the old value shows while the re-read is under way
    off()
  })

  it('a reader that arrives while the first fetch is still in flight joins it', () => {
    const h = harness<number>(0)
    const store = createIpcStore(h.options)
    store.subscribe(() => {})()
    store.subscribe(() => {})()
    expect(h.calls.fetch).toBe(1)
  })

  it('overlapping refreshes resolve latest-request-wins, whichever answers first', async () => {
    const h = harness<number>(0)
    const store = createIpcStore(h.options)
    const first = store.refresh()
    const second = store.refresh()
    h.fetches[1].resolve(2)
    h.fetches[0].resolve(1)
    await Promise.all([first, second])
    expect(store.getSnapshot()).toBe(2)
  })

  it('an invalidation signal re-fetches once for all subscribers', async () => {
    const h = harness<number>(0)
    const store = createIpcStore(h.options)
    const offs = [store.subscribe(() => {}), store.subscribe(() => {})]
    h.fetches[0].resolve(1)
    await flush()
    h.invalidate()
    expect(h.calls.fetch).toBe(2)
    h.fetches[1].resolve(2)
    await flush()
    expect(store.getSnapshot()).toBe(2)
    offs.forEach((off) => { off() })
  })

  it('current() joins a fetch started since the last signal, and starts a new one after a signal', async () => {
    const h = harness<number>(0)
    const store = createIpcStore(h.options)
    const a = store.current()
    const b = store.current()
    expect(h.calls.fetch).toBe(1)
    h.fetches[0].resolve(1)
    expect(await a).toBe(1)
    expect(await b).toBe(1)
    // A finished fetch is never reused: the next ask is a fresh one.
    void store.current()
    expect(h.calls.fetch).toBe(2)
    const off = store.onInvalidate(() => {})
    h.invalidate()
    void store.current()
    // The second fetch above is still in flight, but it predates the signal: not joined.
    expect(h.calls.fetch).toBe(3)
    off()
  })

  it('onInvalidate callbacks run after the store has started its own re-fetch, and current() joins it', async () => {
    const h = harness<number>(0)
    const store = createIpcStore(h.options)
    const off = store.subscribe(() => {})
    h.fetches[0].resolve(1)
    await flush()
    let joined: Promise<number> = Promise.resolve(-1)
    const offSignal = store.onInvalidate(() => { joined = store.current() })
    h.invalidate()
    expect(h.calls.fetch).toBe(2)
    h.fetches[1].resolve(5)
    expect(await joined).toBe(5)
    off()
    offSignal()
  })

  it('keeps the old reference and does not notify when equal says nothing changed', async () => {
    const h = harness<{ n: number }>({ n: 0 })
    const store = createIpcStore({ ...h.options, equal: (a, b) => a.n === b.n })
    let notified = 0
    const off = store.subscribe(() => { notified += 1 })
    h.fetches[0].resolve({ n: 1 })
    await flush()
    const first = store.getSnapshot()
    const before = notified
    h.push({ n: 1 })
    expect(store.getSnapshot()).toBe(first)
    expect(notified).toBe(before)
    off()
  })

  it('reports a failed background fetch instead of throwing, and keeps the value', async () => {
    const h = harness<number>(3)
    const errors: unknown[] = []
    const store = createIpcStore({ ...h.options, onError: (e) => { errors.push(e) } })
    const off = store.subscribe(() => {})
    h.fetches[0].reject(new Error('boom'))
    await flush()
    await flush()
    expect(errors).toHaveLength(1)
    expect(store.getSnapshot()).toBe(3)
    off()
  })

  it('starts over when the bridge is replaced, so one test never sees another’s data', async () => {
    const h = harness<string | null>(null)
    const store = createIpcStore(h.options)
    const off = store.subscribe(() => {})
    h.fetches[0].resolve('old')
    await flush()
    off()
    expect(store.getSnapshot()).toBe('old')
    h.swapBridge()
    expect(store.getSnapshot()).toBeNull() // pure: answers initial without mutating
    const off2 = store.subscribe(() => {})
    expect(h.calls.fetch).toBe(2)
    off2()
  })
})

describe('createKeyedIpcStore', () => {
  interface Chat { id: string; prev: string | null; text: string }

  function keyed() {
    const h = harness<Chat | null>(null)
    const fetched: string[] = []
    const answers = new Map<string, ReturnType<typeof deferred<Chat | null>>>()
    const store = createKeyedIpcStore<Chat | null>({
      ...h.options,
      fetch: (key) => {
        fetched.push(key)
        const d = deferred<Chat | null>()
        answers.set(key, d)
        return d.promise
      },
      subscribe: (push, invalidate) => h.options.subscribe(push, invalidate),
      keysOf: (c) => (c === null ? [] : c.prev === null ? [c.id] : [c.id, c.prev]),
    })
    return { h, store, fetched, answers }
  }

  it('a push for session X notifies only X’s subscribers', async () => {
    const { h, store } = keyed()
    let a = 0
    let b = 0
    const offA = store.subscribe('A', () => { a += 1 })
    const offB = store.subscribe('B', () => { b += 1 })
    const aBefore = a
    const bBefore = b
    h.push({ id: 'A', prev: null, text: 'hi' })
    expect(a).toBe(aBefore + 1)
    expect(b).toBe(bBefore)
    expect(store.getSnapshot('A')?.text).toBe('hi')
    expect(store.getSnapshot('B')).toBeNull()
    offA()
    offB()
  })

  it('shares one push subscription across keys and one fetch per key', () => {
    const { h, store, fetched } = keyed()
    const offs = [store.subscribe('A', () => {}), store.subscribe('A', () => {}), store.subscribe('B', () => {})]
    expect(h.calls.subscribe).toBe(1)
    expect(fetched).toEqual(['A', 'B'])
    offs.forEach((off) => { off() })
    expect(h.calls.unsubscribe).toBe(1)
  })

  it('a push that beats a key’s fetch wins, and does not touch another key’s fetch', async () => {
    const { h, store, answers } = keyed()
    const offA = store.subscribe('A', () => {})
    const offB = store.subscribe('B', () => {})
    h.push({ id: 'A', prev: null, text: 'pushed' })
    answers.get('A')?.resolve({ id: 'A', prev: null, text: 'older' })
    answers.get('B')?.resolve({ id: 'B', prev: null, text: 'b' })
    await flush()
    expect(store.getSnapshot('A')?.text).toBe('pushed')
    expect(store.getSnapshot('B')?.text).toBe('b')
    offA()
    offB()
  })

  it('a value belonging to two keys reaches both (a chat that moved onto a new session)', () => {
    const { h, store } = keyed()
    const offOld = store.subscribe('old', () => {})
    const offNew = store.subscribe('new', () => {})
    h.push({ id: 'new', prev: 'old', text: 'moved' })
    expect(store.getSnapshot('old')?.text).toBe('moved')
    expect(store.getSnapshot('new')?.text).toBe('moved')
    offOld()
    offNew()
  })

  it('forgets a key when its last reader leaves, and ignores pushes for keys nobody reads', () => {
    const { h, store, fetched } = keyed()
    const off = store.subscribe('A', () => {})
    h.push({ id: 'A', prev: null, text: 'x' })
    off()
    expect(store.getSnapshot('A')).toBeNull()
    h.push({ id: 'Z', prev: null, text: 'nobody' }) // unwired: no reader left, nothing to hear it
    expect(store.getSnapshot('Z')).toBeNull()
    store.subscribe('A', () => {})()
    expect(fetched).toEqual(['A', 'A'])
  })
})
