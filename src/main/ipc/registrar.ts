import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import {
  IPC, type InvokeKey, type SendKey, type ArgsOf, type ResultOf,
} from '@shared/ipc/contract'
import { log } from '../log/logger'
import type { RemoteEvent } from '../windows/caller'
import type { CHANNEL_SCOPES } from '../remote/scopes'
import { isTrustedSender, type SenderPolicy } from './ipcSenderGuard'

/**
 * The main-side registrar (MAIN-11, MAIN-13, MAIN-19 item 4): the one place every `invoke` and
 * `send` channel is wired up, instead of `ipc.ts`'s repeated `ipcMain.handle`/`ipcMain.on` calls.
 *
 * `Handlers`/`Listeners` are keyed by the contract's `InvokeKey`/`SendKey`, so a domain module
 * that forgets a channel — or a channel added to the contract with no handler anywhere — is a
 * `satisfies Handlers` compile error at the composition root (`ipc/index.ts`), not a "No handler
 * registered" thrown the first time a user clicks the button.
 */

type IsRemote<K extends keyof typeof CHANNEL_SCOPES> = (typeof CHANNEL_SCOPES)[K] extends 'remote' ? true : false
type InvokeEventFor<K extends InvokeKey> = IsRemote<K> extends true ? RemoteEvent : IpcMainInvokeEvent
type SendEventFor<K extends SendKey> = IsRemote<K> extends true ? RemoteEvent : IpcMainEvent

export type Handlers = {
  [K in InvokeKey]: (e: InvokeEventFor<K>, ...a: ArgsOf<K>) => ResultOf<K> | Promise<ResultOf<K>>
}
export type Listeners = {
  [K in SendKey]: (e: SendEventFor<K>, ...a: ArgsOf<K>) => void
}

/** The one path a call takes, whoever made it: the argument guard, the logging, the handler. */
export interface Dispatcher {
  invoke(key: InvokeKey, event: RemoteEvent | IpcMainInvokeEvent, raw: unknown[]): Promise<unknown>
  send(key: SendKey, event: RemoteEvent | IpcMainEvent, raw: unknown[]): void
}

/**
 * Wraps every handler and listener the same way, for a local window (`registerAll`) and a remote
 * one (`RemoteServer`) alike:
 *
 * - **Argument-guarded**: the contract's own `Guard` runs before the handler does, so a malformed
 *   call from a stale or compromised renderer (a `reportTabs` that is not an array of tabs, a
 *   `settingsSet` that is not an object) is rejected here instead of throwing a `TypeError` deep
 *   inside a handler — which, for a `send` channel with nothing to catch it, used to be an
 *   uncaught exception that took the whole main process down (MAIN-19).
 * - **Logged**: a slow `invoke` (>2s) and any handler or listener that throws are logged, the
 *   instrumentation the "Open installer" bug needed and did not have.
 *
 * Who may call is not decided here: `registerAll` checks the sender frame, the remote server checks
 * the channel's scope.
 */
export function createDispatcher(handlers: Partial<Handlers>, listeners: Partial<Listeners>): Dispatcher {
  return {
    async invoke(key, event, raw) {
      const spec = IPC[key]
      if (!spec.args(raw)) {
        log.warn('ipc', 'rejected arguments', { channel: spec.channel })
        throw new Error('Invalid request.')
      }
      const started = Date.now()
      try {
        const fn = handlers[key] as ((e: unknown, ...a: unknown[]) => unknown) | undefined
        if (fn === undefined) throw new Error('No handler registered.')
        const result = await fn(event, ...raw)
        const ms = Date.now() - started
        // Only the slow ones: logging every call would bury the interesting lines in traffic.
        if (ms > 2000) log.warn('ipc', 'slow handler', { channel: spec.channel, ms })
        return result
      } catch (error) {
        // `warn`, not `error`: a rejecting handler is usually an *expected* failure on its way to
        // being shown to the user — see the renderer's uncaught-error net for what `error` means.
        log.warn('ipc', 'handler failed', { channel: spec.channel, ms: Date.now() - started, error })
        throw error
      }
    },
    send(key, event, raw) {
      const spec = IPC[key]
      if (!spec.args(raw)) {
        log.warn('ipc', 'rejected arguments', { channel: spec.channel })
        return
      }
      try {
        const fn = listeners[key] as ((e: unknown, ...a: unknown[]) => void) | undefined
        fn?.(event, ...raw)
      } catch (error) {
        // `ipcMain.on` has no return value for anything to await, so before this wrapper existed
        // a listener that threw (a malformed `reportTabs` doing `tabs.map`) was an uncaught
        // exception in the main process — see `index.ts`'s "took the whole main process down"
        // note and MAIN-19.
        log.warn('ipc', 'listener failed', { channel: spec.channel, error })
      }
    },
  }
}

/**
 * Registers every handler and listener of `dispatcher` on `ipcMain`, **sender-checked** (SEC-8):
 * rejects anything not from Apiary's own renderer page.
 *
 * Returns a disposer that removes every channel this call registered.
 */
/** What `registerAll` asks before a bound window's call reaches the local dispatcher (`remote/remoteWindows.ts`). */
export interface CallRouter {
  /** `undefined`: handle it at home. Otherwise the call's outcome. */
  routeInvoke(senderId: number, key: InvokeKey, raw: unknown[]): Promise<unknown> | undefined
  /** `true` when the send was forwarded or dropped; `false`: handle it at home. */
  routeSend(senderId: number, key: SendKey, raw: unknown[]): boolean
}

export function registerAll(
  handlers: Handlers,
  listeners: Listeners,
  senderPolicy: SenderPolicy,
  dispatcher: Dispatcher = createDispatcher(handlers, listeners),
  router: CallRouter | null = null,
): () => void {
  const keys = { invoke: Object.keys(handlers) as InvokeKey[], send: Object.keys(listeners) as SendKey[] }
  const fromApp = (senderFrameUrl: string | undefined): boolean => {
    const ok = isTrustedSender(senderFrameUrl, senderPolicy)
    if (!ok) log.warn('ipc', 'rejected a message from an unexpected sender', { senderFrameUrl })
    return ok
  }

  for (const key of keys.invoke) {
    ipcMain.handle(IPC[key].channel, (event, ...raw: unknown[]) => {
      if (!fromApp(event.senderFrame?.url)) throw new Error('Rejected: unexpected sender.')
      // The argument guard runs here too, so a bound window's malformed call is refused before it crosses.
      if (router !== null) {
        if (!IPC[key].args(raw)) throw new Error('Invalid request.')
        const routed = router.routeInvoke(event.sender.id, key, raw)
        if (routed !== undefined) return routed
      }
      return dispatcher.invoke(key, event, raw)
    })
  }

  for (const key of keys.send) {
    ipcMain.on(IPC[key].channel, (event, ...raw: unknown[]) => {
      if (!fromApp(event.senderFrame?.url)) return
      if (router !== null) {
        if (!IPC[key].args(raw)) return
        if (router.routeSend(event.sender.id, key, raw)) return
      }
      dispatcher.send(key, event, raw)
    })
  }

  return () => {
    for (const key of keys.invoke) ipcMain.removeHandler(IPC[key].channel)
    for (const key of keys.send) ipcMain.removeAllListeners(IPC[key].channel)
  }
}
