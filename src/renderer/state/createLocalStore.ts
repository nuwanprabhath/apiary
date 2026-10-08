import { useSyncExternalStore } from 'react'

/**
 * The one way to keep renderer state that main does not own and nothing saves: a value that lives
 * for this window, outlives the component that set it, and is shared by everyone who reads it (the
 * "Hide tool calls" switch has to survive a tab switch, which unmounts the transcript).
 *
 * Which store to use (src/renderer/state/CLAUDE.md has the same table):
 * - main owns it and pushes changes → `createIpcStore`;
 * - it is saved per viewer (sizes, collapsed sections) → `state/uiState.ts`;
 * - only this window needs it, in memory → this.
 *
 * Before this existed, a store like that was hand-written each time: a `Set` of listeners, a
 * `subscribe`, `useSyncExternalStore`, and some way for component tests to start clean. The first
 * hand-written copy was caught by the duplicate-symbol test and renamed past it, which is why
 * `apiary/stores-via-factory` now keeps `useSyncExternalStore` inside the store factories.
 *
 * Component tests swap `window.apiary` for a new fake on every `renderApp()`; production never
 * replaces it. A local store, like `createIpcStore`, starts over from `initial` when it notices a
 * new bridge, so no test sees state another left behind and no store needs test plumbing of its own.
 */
export interface LocalStore<T> {
  /** The current value; stable between changes. */
  get: () => T
  /** Replaces the value (or derives it from the current one) and tells every reader. */
  set: (next: T | ((current: T) => T)) => void
  /** Reads the value, or a part of it, and re-renders only when that part changes. */
  useStore: {
    (): T
    <S>(selector: (value: T) => S): S
  }
}

export function createLocalStore<T>(initial: T, options: { equal?: (a: T, b: T) => boolean } = {}): LocalStore<T> {
  const equal = options.equal ?? Object.is
  const listeners = new Set<() => void>()
  let value = initial
  let boundTo: unknown = window.apiary

  /** Starts over for a bridge this store has not seen (see above). Pure when nothing changed. */
  const current = (): T => (window.apiary === boundTo ? value : initial)

  const get = (): T => current()

  const set = (next: T | ((current: T) => T)): void => {
    if (window.apiary !== boundTo) {
      boundTo = window.apiary
      value = initial
    }
    const resolved = typeof next === 'function' ? (next as (current: T) => T)(value) : next
    if (equal(resolved, value)) return
    value = resolved
    for (const listener of [...listeners]) listener()
  }

  const listen = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  function useStore(): T
  function useStore<S>(selector: (value: T) => S): S
  function useStore<S>(selector?: (value: T) => S): T | S {
    const read = (): T | S => (selector ? selector(current()) : current())
    return useSyncExternalStore(listen, read, read)
  }

  return { get, set, useStore }
}
