/**
 * One shared `onPtyData`/`onPtyExit` subscription, dispatching to per-pty listeners by id (UI-10).
 *
 * Before this, every mounted `TerminalView` called `window.apiary.onPtyData` for itself and
 * filtered by id inline — and terminals stay mounted (hidden, not unmounted) for every open tab by
 * design, so 10 tabs × 3 terminals meant 30 `ipcRenderer.on('apiary:pty-data', …)` listeners in one
 * window, past Node's `EventEmitter` default of 10. This collapses that to exactly one listener
 * per channel, no matter how many terminals are on screen.
 *
 * Mirrors `treeStore.ts`'s `ensureBound` for the same reason: `tests/component` swaps in a brand
 * new `fakeApiary` on every `renderApp()`, and the bus has to notice and resubscribe to the new
 * one rather than keep forwarding events from a bridge no test can see any more.
 */

type DataListener = (data: string) => void
type ExitListener = (exitCode: number) => void

const dataListeners = new Map<string, Set<DataListener>>()
const exitListeners = new Map<string, Set<ExitListener>>()

let boundApiary: typeof window.apiary | null = null
let unsubData: (() => void) | null = null
let unsubExit: (() => void) | null = null

function ensureBound(): void {
  if (window.apiary === boundApiary) return
  unsubData?.()
  unsubExit?.()
  boundApiary = window.apiary
  unsubData = window.apiary.onPtyData((id, data) => {
    for (const cb of dataListeners.get(id) ?? []) cb(data)
  })
  unsubExit = window.apiary.onPtyExit((id, exitCode) => {
    for (const cb of exitListeners.get(id) ?? []) cb(exitCode)
  })
}

function subscribe<T>(map: Map<string, Set<T>>, id: string, cb: T): () => void {
  ensureBound()
  let set = map.get(id)
  if (!set) {
    set = new Set()
    map.set(id, set)
  }
  set.add(cb)
  return () => {
    set?.delete(cb)
    if (set?.size === 0) map.delete(id)
  }
}

export const ptyBus = {
  /** Calls `cb` with every chunk written to `id`'s pty, until the returned function is called. */
  onData: (id: string, cb: DataListener): (() => void) => subscribe(dataListeners, id, cb),
  /** Calls `cb` once, when `id`'s pty exits, until the returned function is called. */
  onExit: (id: string, cb: ExitListener): (() => void) => subscribe(exitListeners, id, cb),
}
