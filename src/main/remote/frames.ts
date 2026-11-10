import { deserialize, serialize } from 'node:v8'

/**
 * Length-prefixed frames over a byte stream: a 4-byte big-endian length, a 1-byte kind, then the
 * message.
 *
 * - **V8 (kind 1)**, for every message after the handshake: V8's structured-clone format, the one
 *   Electron's own IPC uses, so a value crosses to a remote machine exactly as it crosses to a local
 *   window (`undefined`, `Date`, `Map` and typed arrays survive; a function fails here as there).
 * - **JSON (kind 2)**, for the handshake (`hello`, `welcome`, `refused`): V8's format changes between
 *   Electron versions, and two machines on different Apiary versions must still read each other's
 *   hello, or the user gets a decoding error instead of "update one of them".
 */

/** A message larger than this is refused: no legitimate call or event comes near it (a transcript
 *  page or an image is a few MB), and a corrupt length would otherwise allocate gigabytes. */
export const MAX_FRAME_BYTES = 64 * 1024 * 1024

const V8 = 1
const JSON_KIND = 2

function frame(kind: number, body: Buffer): Buffer {
  if (body.length + 1 > MAX_FRAME_BYTES) throw new Error(`Message too large to send (${String(body.length)} bytes).`)
  const header = Buffer.alloc(5)
  header.writeUInt32BE(body.length + 1, 0)
  header.writeUInt8(kind, 4)
  return Buffer.concat([header, body])
}

/** A message after the handshake, in V8's structured-clone format. */
export function encodeFrame(message: unknown): Buffer {
  return frame(V8, serialize(message))
}

/** A handshake message (`hello`, `welcome`, `refused`), in JSON every version can read. */
export function encodeHandshakeFrame(message: unknown): Buffer {
  return frame(JSON_KIND, Buffer.from(JSON.stringify(message), 'utf8'))
}

/**
 * Collects chunks as they arrive and hands out each complete message. A chunk may hold part of a
 * frame, several frames, or both; `push` returns every message completed by it, in order.
 * While `handshakeOnly` is set a V8 frame is an error: nothing is deserialized before the hello is
 * accepted. `decode` yields one message at a time, so the caller can clear the flag between two
 * frames of one chunk.
 */
export class FrameDecoder {
  /** Chunks not yet consumed, oldest first; `buffered` is their total length. */
  private chunks: Buffer[] = []
  private buffered = 0
  handshakeOnly = false

  /** `allocate` makes the one buffer a frame is assembled in; tests inject a counting one. */
  constructor(private readonly allocate: (size: number) => Buffer = (n) => Buffer.allocUnsafe(n)) {}

  push(chunk: Buffer): unknown[] {
    return [...this.decode(chunk)]
  }

  /** The first `size` buffered bytes, copied out and left in place. Only used for the header. */
  private peek(size: number): Buffer {
    const out = Buffer.alloc(size)
    let at = 0
    for (const chunk of this.chunks) {
      if (at >= size) break
      at += chunk.copy(out, at, 0, Math.min(chunk.length, size - at))
    }
    return out
  }

  /** Removes and returns the first `size` buffered bytes, copying each byte at most once. */
  private take(size: number): Buffer {
    this.buffered -= size
    const head = this.chunks[0]
    if (head && head.length >= size) {
      if (head.length === size) this.chunks.shift()
      else this.chunks[0] = head.subarray(size)
      return head.subarray(0, size)
    }
    const out = this.allocate(size)
    let at = 0
    while (at < size) {
      const chunk = this.chunks[0]
      if (!chunk) break
      const n = Math.min(chunk.length, size - at)
      chunk.copy(out, at, 0, n)
      at += n
      if (n === chunk.length) this.chunks.shift()
      else this.chunks[0] = chunk.subarray(n)
    }
    return out
  }

  *decode(chunk: Buffer): Generator<unknown> {
    if (chunk.length > 0) {
      this.chunks.push(chunk)
      this.buffered += chunk.length
    }
    while (this.buffered >= 4) {
      const length = this.peek(4).readUInt32BE(0)
      if (length > MAX_FRAME_BYTES) throw new Error(`Frame too large (${String(length)} bytes); closing the connection.`)
      if (this.buffered < 4 + length) break
      if (length < 1) throw new Error('Empty frame; closing the connection.')
      const whole = this.take(4 + length)
      const kind = whole.readUInt8(4)
      const body = whole.subarray(5)
      let message: unknown
      if (kind === V8) {
        if (this.handshakeOnly) throw new Error('A V8 frame before the hello; closing the connection.')
        message = deserialize(body)
      } else if (kind === JSON_KIND) message = JSON.parse(body.toString('utf8'))
      else throw new Error(`Unknown frame kind ${String(kind)}; closing the connection.`)
      yield message
    }
  }
}
