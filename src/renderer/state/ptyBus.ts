/**
 * One shared `onPtyData`/`onPtyExit` subscription, dispatching to per-pty listeners by id.
 * Terminals stay mounted (hidden) for every open tab, so per-terminal `ipcRenderer.on` listeners
 * would pass Node's `EventEmitter` default of 10; this keeps it to one per channel.
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
