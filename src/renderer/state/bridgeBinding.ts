/**
 * The two pieces every hand-rolled module store here (`ptyBus`, `mrStatusStore`, `themeStore`) used
 * to write for itself. A store that fans a push out to many listeners, or runs a timer, does not
 * fit `createIpcStore`'s fetch-plus-push shape, but it still has to do these two things the same
 * way.
 */

/**
 * Returns `ensure()`, which runs `start(window.apiary)` once per bridge. `tests/component` swaps in
 * a brand new `fakeApiary` on every `renderApp()` (production never replaces `window.apiary` after
 * preload sets it), so `ensure` notices the change, calls the previous `start`'s returned cleanup
 * and starts again on the new bridge instead of forwarding events from one no test can see.
 * Call `ensure()` from every entry point (subscribe, a snapshot read) before touching the bridge.
 */
export function rebindOnNewBridge(start: (api: typeof window.apiary) => () => void): () => void {
  let boundTo: typeof window.apiary | null = null
  let stop: (() => void) | null = null
  return () => {
    if (window.apiary === boundTo) return
    stop?.()
    boundTo = window.apiary
    stop = start(window.apiary)
  }
}

/** Listeners grouped by key. `add` returns the unsubscribe and forgets a key with no listeners left. */
export function keyedListeners<L>(): { add: (key: string, listener: L) => () => void, of: (key: string) => ReadonlySet<L> } {
  const byKey = new Map<string, Set<L>>()
  const none: ReadonlySet<L> = new Set()
  return {
    add(key, listener) {
      let set = byKey.get(key)
      if (set === undefined) {
        set = new Set()
        byKey.set(key, set)
      }
      set.add(listener)
      return () => {
        set.delete(listener)
        if (set.size === 0 && byKey.get(key) === set) byKey.delete(key)
      }
    },
    // The live set, not a copy: this is the per-chunk path of a terminal's output.
    of: (key) => byKey.get(key) ?? none,
  }
}
