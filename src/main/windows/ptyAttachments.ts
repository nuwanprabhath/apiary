/**
 * Which windows have a view attached to which pty (MAIN-26 step 2), so `ptyData` goes only to the
 * windows that show the pty instead of to every window.
 *
 * A renderer declares an attachment (`ptyAttach`) when a `TerminalView` mounts for a pty id and
 * withdraws it (`ptyDetach`) on unmount. Several windows may attach the same pty (it still belongs
 * to main); a tab moved to another window is the new window attaching and the old one detaching.
 * A window that closes or reloads loses all its attachments here — a reloaded renderer starts
 * with no views and re-attaches as they mount. Keyed by webContents id, not by window object, so
 * it needs nothing from Electron and is unit-testable.
 *
 * Pty exit and state events are not routed through this: they are rare, tiny, and other code
 * (the Active section, session tracking) relies on every window hearing them.
 */
export interface PtyTarget {
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
}

export class PtyAttachments {
  private readonly byWindow = new Map<number, Set<string>>()

  constructor(private readonly resolve: (webContentsId: number) => PtyTarget | null) {}

  attach(webContentsId: number, ptyId: string): void {
    let ids = this.byWindow.get(webContentsId)
    if (!ids) {
      ids = new Set()
      this.byWindow.set(webContentsId, ids)
    }
    ids.add(ptyId)
  }

  detach(webContentsId: number, ptyId: string): void {
    const ids = this.byWindow.get(webContentsId)
    if (!ids) return
    ids.delete(ptyId)
    if (ids.size === 0) this.byWindow.delete(webContentsId)
  }

  /** A window closed or reloaded: it holds no attachments any more. */
  detachWindow(webContentsId: number): void {
    this.byWindow.delete(webContentsId)
  }

  /** Window ids currently attached to `ptyId`. */
  windowsFor(ptyId: string): number[] {
    const out: number[] = []
    for (const [wc, ids] of this.byWindow) if (ids.has(ptyId)) out.push(wc)
    return out
  }

  /** Sends `channel` to just the windows attached to `ptyId`; drops windows that are gone. */
  sendTo(ptyId: string, channel: string, ...args: unknown[]): void {
    for (const wc of this.windowsFor(ptyId)) {
      const target = this.resolve(wc)
      if (target === null || target.isDestroyed()) this.detachWindow(wc)
      else target.send(channel, ...args)
    }
  }
}
