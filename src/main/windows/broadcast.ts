import { BrowserWindow } from 'electron'
import type { EventSpec } from '@shared/ipc/contract'
import { sendEvent } from './sendEvent'

/**
 * Sends `event` to every open window, not just the focused one.
 *
 * With more than one window open, terminal output, tree changes and other state updates belong to
 * whichever windows are showing them — which is not necessarily the one in front, and can be
 * several at once. Sending to a single window leaves a background window's terminal or sidebar
 * stale until it is clicked (MAIN-12). Destroyed windows are skipped rather than filtered ahead of
 * time: one can close between this list being taken and the send landing.
 *
 * `event` is a contract entry (`IPC.petsChanged`), not a channel string, so the payload is checked
 * against the type the renderer's `onPetsChanged` hands its callback — a payload of the wrong shape,
 * or a missing one, is a compile error on the sending side too.
 */
export function broadcast<P extends unknown[]>(event: EventSpec<P>, ...payload: P): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) sendEvent(win.webContents, event, ...payload)
  }
}
