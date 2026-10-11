import type { RemoteHost } from '@shared/domain/remote'
import { remoteStatusStore } from './remoteStatusStore'
import { errorMessage } from '@shared/errors'
import { bestEffort, surface } from './policy'

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
/** A connect (or start) that failed after the dialog that asked for it was closed: nothing is left to
 *  show the text in, so it is a notification (policy 2) saying which host it was. */
export function surfaceLateRemoteFailure(host: string, thrown: unknown): void {
  surface(Promise.reject(new Error(remoteFailureText(thrown))), `Could not connect to ${host}`)
}
/** File → Open Remote Session → Other Host… */
export const onOpenRemoteDialog = (cb: () => void): (() => void) => window.apiary.onOpenRemoteDialog(cb)
/** The hosts a connection could go to, with what is known of each; `probe` has main check every one now (the open dialog).
 *  Policy 1: null after logging when it failed, and the dialog still works with the typed host. */
export const loadRemoteHosts = (probe: boolean): Promise<RemoteHost[] | null> => bestEffort(window.apiary.remoteHosts(probe), 'remote')
/** A probe finished: the whole list again. */
export const onRemoteHostsChanged = (cb: (hosts: RemoteHost[]) => void): (() => void) => window.apiary.onRemoteHostsChanged(cb)
/** Closes this window (a disconnected remote window, once there is nothing left to show). */
export const closeThisWindow = (): void => { window.close() }

/**
 * Runs `fn` when this remote window's connection comes back after a drop, so whatever it showed can
 * be fetched again (main replays the attaches, but anything that changed meanwhile was never sent).
 * The one place that watches for it; stores subscribe, components never do. It follows the window's
 * `remoteStatusStore`, so nothing runs in an ordinary window, which is never sent a status.
 */
export function onRemoteReconnected(fn: () => void): () => void {
  let dropped = remoteStatusStore.getSnapshot()?.state === 'reconnecting'
  return remoteStatusStore.subscribe(() => {
    const state = remoteStatusStore.getSnapshot()?.state
    if (state === 'reconnecting') dropped = true
    if (state === 'connected' && dropped) {
      dropped = false
      fn()
    }
  })
}
