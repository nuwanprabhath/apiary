import { describe, it, expect, beforeEach } from 'vitest'
import { createLocalStore } from '../../src/renderer/state/createLocalStore'

// The store reads `window.apiary` to notice a component test's new bridge; in Node there is no
// window, so give it one whose bridge the tests can swap.
const g = globalThis as unknown as { window: { apiary: unknown } }

describe('createLocalStore', () => {
  beforeEach(() => { g.window = { apiary: {} } })

  it('starts at its initial value and returns what was set', () => {
    const store = createLocalStore(1)
    expect(store.get()).toBe(1)
    store.set(2)
    expect(store.get()).toBe(2)
    store.set((n) => n + 1)
    expect(store.get()).toBe(3)
  })

  it('keeps the value for the life of the window, not of a reader', () => {
    const store = createLocalStore<string | null>(null)
    store.set('flipped')
    expect(store.get()).toBe('flipped')
  })

  it('starts over when a component test swaps in a new bridge', () => {
    const store = createLocalStore(0)
    store.set(5)
    g.window.apiary = {}
    expect(store.get()).toBe(0)
    store.set((n) => n + 1)
    expect(store.get()).toBe(1)
  })

  it('does not replace an equal value', () => {
    const store = createLocalStore({ a: 1 }, { equal: (x, y) => x.a === y.a })
    const first = store.get()
    store.set({ a: 1 })
    expect(store.get()).toBe(first)
  })
})
