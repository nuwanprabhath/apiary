/**
 * One shared `onPtyData`/`onPtyExit` subscription, dispatching to per-pty listeners by id.
 * Terminals stay mounted (hidden) for every open tab, so per-terminal `ipcRenderer.on` listeners
 * would pass Node's `EventEmitter` default of 10; this keeps it to one per channel.
 *
 * Rebinds through `rebindOnNewBridge` for the reason given there: `tests/component` swaps in a
 * brand new `fakeApiary` on every `renderApp()`, and the bus has to resubscribe to the new one.
 */
import type { PtyId } from '@shared/domain/ids'
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

/** How often drawn output is acknowledged to main, at most once per pty. */
const PTY_ACK_INTERVAL_MS = 100

/** Per pty, drawn output not yet acknowledged; flushed together by one timer. */
const unacked = new Map<PtyId, number>()
let ackTimer: ReturnType<typeof setTimeout> | null = null

function flushAcks(): void {
  ackTimer = null
  for (const [id, bytes] of unacked) window.apiary.ptyAck(id, bytes)
  unacked.clear()
}

export const ptyBus = {
  /**
   * `bytes` of `id`'s output (string length, as main counts it) have been drawn. Main pauses a pty
   * whose windows fall behind, so every chunk handed to `onData` is acknowledged once drawn.
   */
  ack: (id: PtyId, bytes: number): void => {
    unacked.set(id, (unacked.get(id) ?? 0) + bytes)
    ackTimer ??= setTimeout(flushAcks, PTY_ACK_INTERVAL_MS)
  },
  /** Calls `cb` with every chunk written to `id`'s pty, until the returned function is called. */
  onData: (id: string, cb: DataListener): (() => void) => { bind(); return dataListeners.add(id, cb) },
  /** Calls `cb` once, when `id`'s pty exits, until the returned function is called. */
  onExit: (id: string, cb: ExitListener): (() => void) => { bind(); return exitListeners.add(id, cb) },
}
