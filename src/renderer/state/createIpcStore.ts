import { useCallback, useSyncExternalStore } from 'react'
import type { LogScope } from '@shared/domain/log'
import { errorMessage } from '@shared/errors'
import { logBackgroundFailure } from '../ui/fireAndForget'

/**
 * The one way the renderer reads data that main owns and pushes (UI-3, UI-10, review §7.1).
 *
 * Seven hooks used to repeat "fetch once, subscribe to a push, guard against a stale answer", each
 * with a different degree of correctness: two let an old initial fetch overwrite a newer pushed
 * value, and two subscribed once per caller (`useChat` ran twice per pane, so a streaming chat's
 * ~25 pushes a second reached every closure in the window). A store built here instead has:
 *
 * - **One subscription and one in-flight fetch** per store (per key, for a keyed store), however
 *   many components read it. The push is wired when the first reader arrives and unwired when the
 *   last one leaves; a late reader just reads the value.
 * - **Ordering.** A push that lands while a fetch is in flight wins: the fetch's answer is older
 *   than what was pushed and is dropped. Overlapping fetches resolve latest-request-wins, so a
 *   slow answer never lands on top of a fast newer one.
 * - **`useStore(selector?)`** (`useSyncExternalStore`), `getSnapshot()` and `refresh()`.
 *
 * Lifetime, deliberately the one `treeStore` already had: an unkeyed store keeps its last value for
 * the life of the window, and re-reads it (stale-while-revalidate) when a reader arrives after
 * none was left, because pushes were not being heard in between. A keyed store forgets a key as
 * soon as its last reader leaves — a chat's whole message list is not worth keeping for a pane that
 * is gone — and a returning reader starts from the initial value and fetches again.
 *
 * `tests/component` swaps `window.apiary` for a brand new fake on every `renderApp()`. The store
 * notices (`bridge()` is a different object) the next time anything asks it for something, drops
 * what it held for the old one and starts over — so no test sees another's data. `getSnapshot` is
 * pure and answers `initial` for a bridge it has not bound yet, rather than resetting as a side
 * effect (which `useSyncExternalStore` does not allow of it).
 */

export interface IpcStoreOptions<T> {
  /** Where failed background reads are logged. */
  scope: LogScope
  /** What readers see before the first answer. */
  initial: T
  /** Reads the current value from main. */
  fetch: () => Promise<T>
  /**
   * Wires main's push. Call `push(next)` with a payload that is the new value; call `invalidate()`
   * for a signal that says "it changed, ask again" (the store then re-fetches, latest wins).
   * Returns the unwiring function.
   */
  subscribe: (push: (next: T) => void, invalidate: () => void) => () => void
  /** True when two values are the same for rendering; the old reference is then kept and nobody is
   *  notified. Default `Object.is`. */
  equal?: (a: T, b: T) => boolean
  /** Identifies the bridge the data came from. Default `window.apiary`; a Node test passes its own. */
  bridge?: () => unknown
  /** Called with a failed background fetch. Default: written to the diagnostic log. */
  onError?: (error: unknown) => void
}

export interface IpcStore<T> {
  /** The current value; `initial` until the first answer. Stable between changes. */
  getSnapshot: () => T
  /** False until the first answer (a push counts). */
  isLoaded: () => boolean
  /** For `useSyncExternalStore`; wires the push on the first reader and starts the first fetch. */
  subscribe: (listener: () => void) => () => void
  /** Reads the store in a component. A `selector` must be pure and return a stable value for an
   *  unchanged store (a field, not a new object). */
  useStore: { (): T; <S>(selector: (value: T) => S): S }
  useLoaded: () => boolean
  /** Starts a fresh fetch (latest wins). Resolves with the answer, or the value that superseded it. */
  refresh: () => Promise<T>
  /** `refresh()` that nobody awaits: a failure is logged, not dropped. */
  reload: () => void
  /**
   * The answer to a fetch that is already in flight and was started since the last push or
   * invalidation, or a new one — never a finished one. Callers woken by the same signal in the same
   * tick therefore share one round trip, and no caller gets an answer older than its signal.
   */
  current: () => Promise<T>
  /** Calls `cb` on every invalidation signal, after the store has started its own re-fetch, so a
   *  `current()` inside `cb` joins that fetch. Keeps the push wired while registered. */
  onInvalidate: (cb: () => void) => () => void
  /** Calls `cb` with every pushed value. Keeps the push wired while registered. */
  onPush: (cb: (value: T) => void) => () => void
}

export interface KeyedIpcStoreOptions<T> extends Omit<IpcStoreOptions<T>, 'fetch' | 'subscribe'> {
  fetch: (key: string) => Promise<T>
  /** As `IpcStoreOptions.subscribe`; `invalidate(key)` re-fetches one key, `invalidate()` every key being read. */
  subscribe: (push: (next: T) => void, invalidate: (key?: string) => void) => () => void
  /** Which keys a pushed value belongs to (usually one). Keys nobody is reading ignore it. */
  keysOf: (value: T) => readonly string[]
  /**
   * Tells main which key this window reads, for a push that goes only to the windows that do (a
   * chat's, like a pty's, is far too frequent to send everywhere). Called when a key gets its first
   * reader, before its fetch starts; the function it returns is called when the last reader leaves.
   * A new `window.apiary` (a test's fresh fake) is attached again for each key still being read.
   */
  attach?: (key: string) => () => void
}

export interface KeyedIpcStore<T> {
  getSnapshot: (key: string) => T
  isLoaded: (key: string) => boolean
  subscribe: (key: string, listener: () => void) => () => void
  useStore: { (key: string): T; <S>(key: string, selector: (value: T) => S): S }
  useLoaded: (key: string) => boolean
  refresh: (key: string) => Promise<T>
  reload: (key: string) => void
  current: (key: string) => Promise<T>
  onInvalidate: (cb: () => void) => () => void
  onPush: (cb: (value: T) => void) => () => void
}

interface Cell<T> {
  value: T
  loaded: boolean
  listeners: Set<() => void>
  /** Bumped by each fetch; only the latest one's answer is applied. */
  fetchId: number
  /** Bumped by each push; a fetch that started before the latest push is out of date. */
  pushSeq: number
  flight: { id: number; epoch: number; pushSeq: number; promise: Promise<T> } | null
  /** Undoes `attach`, while the key has readers. */
  detach: (() => void) | null
}

const NO_BRIDGE = Symbol('no bridge')

const identity = <V>(value: V): V => value

function defaultBridge(): unknown {
  return typeof window === 'undefined' ? null : window.apiary
}

interface Core<T> {
  getSnapshot: (key: string) => T
  isLoaded: (key: string) => boolean
  subscribe: (key: string, listener: () => void) => () => void
  refresh: (key: string) => Promise<T>
  reload: (key: string) => void
  current: (key: string) => Promise<T>
  onInvalidate: (cb: () => void) => () => void
  onPush: (cb: (value: T) => void) => () => void
}

function makeCell<T>(initial: T): Cell<T> {
  return { value: initial, loaded: false, listeners: new Set(), fetchId: 0, pushSeq: 0, flight: null, detach: null }
}

/** Makes `next` the cell's value unless `equal` says it already is, and tells its readers. */
function applyValue<T>(cell: Cell<T>, next: T, equal: (a: T, b: T) => boolean): void {
  const same = equal(cell.value, next)
  const first = !cell.loaded
  cell.loaded = true
  if (!same) cell.value = next
  if (same && !first) return
  for (const listener of [...cell.listeners]) listener()
}

/** Forgets what the cell held and abandons whatever is in flight for it. */
function resetCell<T>(cell: Cell<T>, initial: T): void {
  cell.value = initial
  cell.loaded = false
  cell.fetchId += 1
  cell.pushSeq += 1
  cell.flight = null
}

function startFetch<T>(
  cell: Cell<T>, epoch: number, request: () => Promise<T>, equal: (a: T, b: T) => boolean,
): Promise<T> {
  const id = ++cell.fetchId
  const pushSeq = cell.pushSeq
  const promise = request().then((value) => {
    // Superseded by a newer fetch, or older than a push that landed while it was in flight.
    if (cell.fetchId === id && cell.pushSeq === pushSeq) applyValue(cell, value, equal)
    return cell.pushSeq === pushSeq ? value : cell.value
  })
  cell.flight = { id, epoch, pushSeq, promise }
  const settle = (): void => { if (cell.flight?.id === id) cell.flight = null }
  promise.then(settle, settle)
  return promise
}

/** A fetch that throws before it returns a promise is a rejection like any other. */
function callFetch<T>(fetch: (key: string) => Promise<T>, key: string): Promise<T> {
  try { return fetch(key) } catch (error) { return Promise.reject(new Error(errorMessage(error))) }
}

function attachCell<T>(o: KeyedIpcStoreOptions<T>, cell: Cell<T>, key: string): void {
  cell.detach = o.attach?.(key) ?? null
}

function releaseCell<T>(cell: Cell<T>): void {
  cell.detach?.()
  cell.detach = null
}

function createCore<T>(o: KeyedIpcStoreOptions<T>, retain: boolean): Core<T> {
  const equal = o.equal ?? Object.is
  const bridge = o.bridge ?? defaultBridge
  const report = o.onError ?? ((error: unknown): void => { logBackgroundFailure(error, o.scope) })
  const cells = new Map<string, Cell<T>>()
  const invalidateListeners = new Set<() => void>()
  const pushListeners = new Set<(value: T) => void>()
  let boundTo: unknown = NO_BRIDGE
  let unbind: (() => void) | null = null
  /** Bumped by every invalidation signal. */
  let epoch = 0

  const newCell = (): Cell<T> => makeCell(o.initial)

  const hasDemand = (): boolean => {
    if (invalidateListeners.size > 0 || pushListeners.size > 0) return true
    for (const cell of cells.values()) if (cell.listeners.size > 0) return true
    return false
  }

  /** A fetch nobody awaits: a failure is reported, not dropped. */
  function load(cell: Cell<T>, key: string): void {
    const flight = cell.flight
    // A fetch already under way since the last signal and push is as good as a new one.
    const joinable = flight !== null && flight.epoch === epoch && flight.pushSeq === cell.pushSeq
    const request = joinable ? flight.promise : startFetch(cell, epoch, () => callFetch(o.fetch, key), equal)
    request.catch(report)
  }

  function push(next: T): void {
    for (const key of o.keysOf(next)) {
      const cell = cells.get(key)
      if (cell === undefined) continue
      cell.pushSeq += 1
      applyValue(cell, next, equal)
    }
    for (const cb of [...pushListeners]) cb(next)
  }

  function invalidate(key?: string): void {
    epoch += 1
    for (const [k, cell] of cells) {
      if ((key === undefined || key === k) && cell.listeners.size > 0) load(cell, k)
    }
    for (const cb of [...invalidateListeners]) cb()
  }

  function bind(): void {
    unbind ??= o.subscribe(push, invalidate)
  }

  function unbindIfIdle(): void {
    if (unbind === null || hasDemand()) return
    unbind()
    unbind = null
  }

  /** Starts over when `window.apiary` is not the bridge this store holds data from. */
  function ensureBridge(): void {
    const now = bridge()
    if (now === boundTo) return
    boundTo = now
    epoch += 1
    const wasBound = unbind !== null
    if (unbind !== null) { unbind(); unbind = null }
    for (const [key, cell] of cells) {
      resetCell(cell, o.initial)
      if (!retain && cell.listeners.size === 0) cells.delete(key)
    }
    if (wasBound && hasDemand()) {
      bind()
      for (const [key, cell] of cells) if (cell.listeners.size > 0) { attachCell(o, cell, key); load(cell, key) }
    }
  }

  /** The key's cell: kept for a retained store, a throwaway for a keyed one nobody is reading. */
  function cellFor(key: string): Cell<T> {
    const existing = cells.get(key)
    if (existing !== undefined) return existing
    const made = newCell()
    if (retain) cells.set(key, made)
    return made
  }

  function refresh(key: string): Promise<T> {
    ensureBridge()
    return startFetch(cellFor(key), epoch, () => callFetch(o.fetch, key), equal)
  }

  const peek = (key: string): Cell<T> | undefined => (bridge() === boundTo ? cells.get(key) : undefined)

  return {
    getSnapshot: (key) => { const cell = peek(key); return cell === undefined ? o.initial : cell.value },
    isLoaded: (key) => peek(key)?.loaded ?? false,

    subscribe(key, listener) {
      ensureBridge()
      const mine = cells.get(key) ?? newCell()
      cells.set(key, mine)
      const first = mine.listeners.size === 0
      mine.listeners.add(listener)
      // Wired before the fetch starts, so a push that beats the answer is seen and wins.
      bind()
      if (first) { attachCell(o, mine, key); load(mine, key) }
      return () => {
        mine.listeners.delete(listener)
        if (mine.listeners.size === 0) releaseCell(mine)
        if (mine.listeners.size === 0 && !retain && cells.get(key) === mine) {
          mine.fetchId += 1
          cells.delete(key)
        }
        unbindIfIdle()
      }
    },

    refresh,

    reload(key) {
      refresh(key).catch(report)
    },

    current(key) {
      ensureBridge()
      const cell = cellFor(key)
      const flight = cell.flight
      if (flight !== null && flight.epoch === epoch && flight.pushSeq === cell.pushSeq) return flight.promise
      return startFetch(cell, epoch, () => callFetch(o.fetch, key), equal)
    },

    onInvalidate(cb) {
      ensureBridge()
      invalidateListeners.add(cb)
      bind()
      return () => { invalidateListeners.delete(cb); unbindIfIdle() }
    },

    onPush(cb) {
      ensureBridge()
      pushListeners.add(cb)
      bind()
      return () => { pushListeners.delete(cb); unbindIfIdle() }
    },
  }
}

function useValue<T, S>(
  subscribe: (listener: () => void) => () => void,
  read: () => T,
  selector: (value: T) => S,
): S {
  const get = (): S => selector(read())
  return useSyncExternalStore(subscribe, get, get)
}

/** A store for one value main owns — pets, the update status, the status bar. */
export function createIpcStore<T>(options: IpcStoreOptions<T>): IpcStore<T> {
  const KEY = ''
  const core = createCore<T>({
    ...options,
    fetch: () => options.fetch(),
    subscribe: (push, invalidate) => options.subscribe(push, () => { invalidate() }),
    keysOf: () => [KEY],
  }, true)
  const subscribe = (listener: () => void): (() => void) => core.subscribe(KEY, listener)
  const getSnapshot = (): T => core.getSnapshot(KEY)
  function useStore(): T
  function useStore<S>(selector: (value: T) => S): S
  function useStore(selector: (value: T) => unknown = identity): unknown {
    return useValue(subscribe, getSnapshot, selector)
  }
  return {
    getSnapshot,
    isLoaded: () => core.isLoaded(KEY),
    subscribe,
    useStore,
    useLoaded: () => useSyncExternalStore(subscribe, () => core.isLoaded(KEY), () => core.isLoaded(KEY)),
    refresh: () => core.refresh(KEY),
    reload: () => { core.reload(KEY) },
    current: () => core.current(KEY),
    onInvalidate: core.onInvalidate,
    onPush: core.onPush,
  }
}

/** A store for per-id state main owns — a chat by session. Readers of one key hear only that key. */
export function createKeyedIpcStore<T>(options: KeyedIpcStoreOptions<T>): KeyedIpcStore<T> {
  const core = createCore<T>(options, false)
  function useStore(key: string): T
  function useStore<S>(key: string, selector: (value: T) => S): S
  function useStore(key: string, selector: (value: T) => unknown = identity): unknown {
    const subscribe = useCallback((listener: () => void) => core.subscribe(key, listener), [key])
    return useValue(subscribe, () => core.getSnapshot(key), selector)
  }
  return {
    getSnapshot: core.getSnapshot,
    isLoaded: core.isLoaded,
    subscribe: core.subscribe,
    useStore,
    useLoaded: (key) => {
      const subscribe = useCallback((listener: () => void) => core.subscribe(key, listener), [key])
      return useSyncExternalStore(subscribe, () => core.isLoaded(key), () => core.isLoaded(key))
    },
    refresh: core.refresh,
    reload: core.reload,
    current: core.current,
    onInvalidate: core.onInvalidate,
    onPush: core.onPush,
  }
}
