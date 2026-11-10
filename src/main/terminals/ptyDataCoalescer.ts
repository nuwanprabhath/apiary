/** The most one flush sends for one pty, in UTF-16 units; the rest waits for the next tick. */
export const FLUSH_CAP = 256 * 1024

function isHighSurrogate(code: number): boolean { return code >= 0xd800 && code <= 0xdbff }

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
  private readonly observers: Array<(id: string, data: string) => void> = []
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

  /** Also told what each flush sent, after it was sent (flow control counts it). */
  onFlushed(listener: (id: string, data: string) => void): void { this.observers.push(listener) }

  private flush(id: string): void {
    this.scheduled.delete(id)
    const chunks = this.buffers.get(id)
    this.buffers.delete(id)
    if (chunks === undefined || chunks.length === 0) return
    let data = chunks.length === 1 ? (chunks[0] ?? '') : chunks.join('')
    if (data.length > FLUSH_CAP) {
      // A flood is sent a slice per tick, so one pty cannot hold main for a whole multi-megabyte send.
      const cut = isHighSurrogate(data.charCodeAt(FLUSH_CAP - 1)) ? FLUSH_CAP - 1 : FLUSH_CAP
      this.buffers.set(id, [data.slice(cut)])
      this.scheduled.set(id, this.schedule(() => this.flush(id)))
      data = data.slice(0, cut)
    }
    this.onFlush(id, data)
    for (const o of this.observers) o(id, data)
  }

  /** Cancels every pending flush without sending it — for a clean quit. Buffered-but-unsent bytes
   *  are dropped, which is safe here: the pty they belong to is going away with the process. */
  dispose(): void {
    for (const handle of this.scheduled.values()) handle.cancel()
    this.scheduled.clear()
    this.buffers.clear()
  }
}
