/**
 * One shared `onPtyData`/`onPtyExit` subscription, dispatching to per-pty listeners by id (UI-10).
 *
 * Before this, every mounted `TerminalView` called `window.apiary.onPtyData` for itself and
 * filtered by id inline — and terminals stay mounted (hidden, not unmounted) for every open tab by
 * design, so 10 tabs × 3 terminals meant 30 `ipcRenderer.on('apiary:pty-data', …)` listeners in one
 * window, past Node's `EventEmitter` default of 10. This collapses that to exactly one listener
 * per channel, no matter how many terminals are on screen.
 *
 * Rebinds through `rebindOnNewBridge` for the reason given there: `tests/component` swaps in a
 * brand new `fakeApiary` on every `renderApp()`, and the bus has to resubscribe to the new one.
 */
import { keyedListeners, rebindOnNewBridge } from './bridgeBinding'

type DataListener = (data: string) => void
type ExitListener = (exitCode: number) => void

const dataListeners = keyedListeners<DataListener>()
const exitListeners = keyedListeners<ExitListener>()

const bind = rebindOnNewBridge((api) => {
  const unsubData = api.onPtyData((id, data) => {
    for (const cb of dataListeners.of(id)) cb(data)
  })
  const unsubExit = api.onPtyExit((id, exitCode) => {
    for (const cb of exitListeners.of(id)) cb(exitCode)
  })
  return () => { unsubData(); unsubExit() }
})

export const ptyBus = {
  /** Calls `cb` with every chunk written to `id`'s pty, until the returned function is called. */
  onData: (id: string, cb: DataListener): (() => void) => { bind(); return dataListeners.add(id, cb) },
  /** Calls `cb` once, when `id`'s pty exits, until the returned function is called. */
  onExit: (id: string, cb: ExitListener): (() => void) => { bind(); return exitListeners.add(id, cb) },
}
