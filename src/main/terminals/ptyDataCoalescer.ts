export interface PtyDataCoalescerOptions {
  /** Called with the concatenated chunks for one pty, at most once per scheduled flush. */
  onFlush: (id: string, data: string) => void
  /** Injectable for tests; defaults to `setImmediate`. */
  schedule?: (cb: () => void) => { cancel: () => void }
}

/**
 * Coalesces pty output into at most one broadcast per pty per tick.
 *
 * `node-pty` emits many small chunks for a single TUI repaint (the chunking is an artifact of its
 * read buffer size); sending each one as a `broadcast()` is one `webContents.send` per open window,
 * per chunk.
 *
 * Buffering per pty id and flushing on `setImmediate` keeps chunks that arrive within one
 * microtask-queue drain together, without a visible delay: `setImmediate` runs before the next I/O
 * callback, well under a frame. Chunks are joined in arrival order, so nothing is reordered or
 * dropped; xterm parses a pty's output as one continuous stream.
 */
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
