import { createReadStream } from 'node:fs'
import { errorMessage } from '@shared/errors'
import type { TranscriptMessage } from '@shared/types'
import { MAX_LINE_CHARS, toMessage } from './transcriptReader'

const NEWLINE = 0x0a

/** UTF-8 spends at most three bytes per UTF-16 unit, so a longer run of bytes is over the char cap too. */
const MAX_LINE_BYTES = MAX_LINE_CHARS * 3

/**
 * Visits the messages on the whole lines from `startByte` on, and returns the byte offset just past
 * the last line read. A partial last line is left for the next call, which starts from that offset.
 */
export function forEachMessageFrom(
  filePath: string,
  startByte: number,
  visit: (message: TranscriptMessage) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let consumed = startByte
    let lineBytes = 0
    let chunks: Buffer[] = []
    let overflow = false

    const stream = createReadStream(filePath, { start: startByte })
    const endLine = (): void => {
      if (!overflow) {
        const message = messageOf(Buffer.concat(chunks).toString('utf8'))
        if (message !== null) visit(message)
      }
      consumed += lineBytes + 1
      lineBytes = 0
      overflow = false
      chunks = []
    }
    const readChunk = (chunk: Buffer): void => {
      let from = 0
      for (;;) {
        const nl = chunk.indexOf(NEWLINE, from)
        const end = nl === -1 ? chunk.length : nl
        lineBytes += end - from
        if (!overflow) {
          if (lineBytes > MAX_LINE_BYTES) {
            overflow = true
            chunks = []
          } else {
            chunks.push(chunk.subarray(from, end))
          }
        }
        if (nl === -1) return
        endLine()
        from = nl + 1
      }
    }

    stream.on('data', (chunk: Buffer) => {
      try {
        readChunk(chunk)
      } catch (err) {
        stream.destroy()
        reject(new Error(errorMessage(err)))
      }
    })
    stream.on('end', () => resolve(consumed))
    stream.on('error', reject)
  })
}

function messageOf(text: string): TranscriptMessage | null {
  if (text.length === 0 || text.length > MAX_LINE_CHARS) return null
  let entry: unknown
  try {
    entry = JSON.parse(text)
  } catch {
    return null
  }
  return typeof entry === 'object' && entry !== null ? toMessage(entry as Record<string, unknown>) : null
}
