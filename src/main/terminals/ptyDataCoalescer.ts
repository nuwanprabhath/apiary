/**
 * Coalesces pty output into at most one broadcast per pty per tick (MAIN-26 step 1).
 *
 * `node-pty` emits many small chunks for a single TUI repaint, and `ipc/handlers/tabs.ts` used to
 * turn each one straight into a `broadcast()` — one `webContents.send` per open window, per chunk.
 * With several windows open, a busy terminal (a build log, a fast-scrolling `ls -R`) serialised
 * and sent the same bytes across the IPC boundary once per window for every chunk `node-pty`
 * happened to emit them in, which is an artifact of its read buffer size, not of anything the UI
 * needs to see separately.
 *
 * Buffering per pty id and flushing on `setImmediate` — VS Code's terminal does the same — keeps
 * chunks that arrive within one microtask-queue drain together as one larger write, without
 * introducing a visible delay: `setImmediate` runs before the next I/O callback, well under a
 * frame. Chunks for one pty are joined in the order they arrived, so a flush is exactly what
 * sending each chunk individually would have produced, concatenated — nothing is reordered or
 * dropped, which matters here because xterm parses a pty's output as one continuous stream.
 */
export interface PtyDataCoalescerOptions {
  /** Called with the concatenated chunks for one pty, at most once per scheduled flush. */
  onFlush: (id: string, data: string) => void
  /** Injectable for tests; defaults to `setImmediate`. */
  schedule?: (cb: () => void) => { cancel: () => void }
}

export class PtyDataCoalescer {
  private readonly buffers = new Map<string, string[]>()
  private readonly scheduled = new Map<string, { cancel: () => void }>()
  private readonly onFlush: (id: string, data: string) => void
  private readonly schedule: (cb: () => void) => { cancel: () => void }

  constructor(options: PtyDataCoalescerOptions) {
    this.onFlush = options.onFlush
    this.schedule = options.schedule ?? ((cb) => {
      const handle = setImmediate(cb)
      return { cancel: () => { clearImmediate(handle) } }
    })
  }

  /** Call on every pty data chunk. */
  push(id: string, chunk: string): void {
    const existing = this.buffers.get(id)
    if (existing) {
      existing.push(chunk)
      return
    }
    this.buffers.set(id, [chunk])
    this.scheduled.set(id, this.schedule(() => this.flush(id)))
  }

  private flush(id: string): void {
    this.scheduled.delete(id)
    const chunks = this.buffers.get(id)
    this.buffers.delete(id)
    if (chunks === undefined || chunks.length === 0) return
    this.onFlush(id, chunks.length === 1 ? chunks[0] : chunks.join(''))
  }

  /** Cancels every pending flush without sending it — for a clean quit. Buffered-but-unsent bytes
   *  are dropped, which is safe here: the pty they belong to is going away with the process. */
  dispose(): void {
    for (const handle of this.scheduled.values()) handle.cancel()
    this.scheduled.clear()
    this.buffers.clear()
  }
}
