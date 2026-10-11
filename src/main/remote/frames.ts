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
 *   hello, or the user gets a decoding error instead of "update one of them". Found when a plain
 *   Node client could not read an Electron server's frames (the Docker test bed).
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
 */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): unknown[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    const out: unknown[] = []
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0)
      if (length > MAX_FRAME_BYTES) throw new Error(`Frame too large (${String(length)} bytes); closing the connection.`)
      if (this.buffer.length < 4 + length) break
      if (length < 1) throw new Error('Empty frame; closing the connection.')
      const kind = this.buffer.readUInt8(4)
      const body = this.buffer.subarray(5, 4 + length)
      if (kind === V8) out.push(deserialize(body))
      else if (kind === JSON_KIND) out.push(JSON.parse(body.toString('utf8')))
      else throw new Error(`Unknown frame kind ${String(kind)}; closing the connection.`)
      this.buffer = this.buffer.subarray(4 + length)
    }
    return out
  }
}
