import type { RemoteHost, RemoteStatus } from '@shared/domain/remote'
import { errorMessage } from '@shared/errors'
import { bestEffort } from './policy'

/** Connect to a work machine; main opens its window. Policy 3: rejects with main's words (ssh or
 *  Apiary refused), which the dialog and the banner show whole. */
export const connectRemote = (host: string, pairing?: string): Promise<void> =>
  pairing === undefined ? window.apiary.remoteConnect(host) : window.apiary.remoteConnect(host, pairing)
export const startRemoteAndConnect = (host: string): Promise<void> => window.apiary.remoteStartAndConnect(host)
/** What a failed `connectRemote` says, whole: ssh's own lines are what a person needs to act on, so
 *  nothing is cut to a headline; only Electron's "Error invoking remote method" wrapper goes. */
export function remoteFailureText(thrown: unknown): string {
  return errorMessage(thrown).replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '')
}
/** File → Open Remote Session → Other Host… */
export const onOpenRemoteDialog = (cb: () => void): (() => void) => window.apiary.onOpenRemoteDialog(cb)
/** A remote window's connection changed. */
export const onRemoteStatus = (cb: (status: RemoteStatus) => void): (() => void) => window.apiary.onRemoteStatus(cb)
/** The hosts a connection could go to, with what is known of each; `probe` has main check every one now (the open dialog).
 *  Policy 1: null after logging when it failed, and the dialog still works with the typed host. */
export const loadRemoteHosts = (probe: boolean): Promise<RemoteHost[] | null> => bestEffort(window.apiary.remoteHosts(probe), 'remote')
/** A probe finished: the whole list again. */
export const onRemoteHostsChanged = (cb: (hosts: RemoteHost[]) => void): (() => void) => window.apiary.onRemoteHostsChanged(cb)
/** Closes this window (a disconnected remote window, once there is nothing left to show). */
export const closeThisWindow = (): void => { window.close() }

const reconnectListeners = new Set<() => void>()
let offStatus: (() => void) | null = null

/**
 * Runs `fn` when this remote window's connection comes back after a drop, so whatever it showed can
 * be fetched again (main replays the attaches, but anything that changed meanwhile was never sent).
 * The one place that watches for it; stores subscribe, components never do. Nothing runs in an
 * ordinary window, which hears no `remoteStatus`.
 */
export function onRemoteReconnected(fn: () => void): () => void {
  reconnectListeners.add(fn)
  if (offStatus === null) {
    let dropped = false
    offStatus = window.apiary.onRemoteStatus((status) => {
      if (status.state === 'reconnecting') dropped = true
      if (status.state === 'connected' && dropped) {
        dropped = false
        for (const listener of [...reconnectListeners]) listener()
      }
    })
  }
  return () => {
    reconnectListeners.delete(fn)
    if (reconnectListeners.size === 0) { offStatus?.(); offStatus = null }
  }
}
