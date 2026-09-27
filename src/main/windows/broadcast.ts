import { BrowserWindow } from 'electron'

/**
 * Sends `channel` to every open window, not just the focused one.
 *
 * With more than one window open, terminal output, tree changes and other state updates belong to
 * whichever windows are showing them — which is not necessarily the one in front, and can be
 * several at once. Sending to a single window leaves a background window's terminal or sidebar
 * stale until it is clicked (MAIN-12). Destroyed windows are skipped rather than filtered ahead of
 * time: one can close between this list being taken and the send landing.
 *
 * This was six near-identical hand-rolled loops (`ipc.ts`, `index.ts`, `themeIpc.ts`); this is the
 * one place left to add, say, per-window filtering.
 */
export function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }
}
