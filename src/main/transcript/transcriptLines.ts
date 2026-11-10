import type { TranscriptMessage } from '@shared/types'
import { MAX_LINE_CHARS, forEachLine } from './jsonlLines'
import { toMessage } from './transcriptReader'

/** UTF-8 spends at most three bytes per UTF-16 unit, so a longer run of bytes is over the char cap too. */
const MAX_LINE_BYTES = MAX_LINE_CHARS * 3

/**
 * Visits the messages on the whole lines from `startByte` on, and returns the byte offset just past
 * the last line read. A partial last line is left for the next call, which starts from that offset.
 */
export async function forEachMessageFrom(
  filePath: string,
  startByte: number,
  visit: (message: TranscriptMessage) => void,
): Promise<number> {
  const { nextOffset } = await forEachLine(filePath, { start: startByte, maxLineBytes: MAX_LINE_BYTES }, (line) => {
    const message = messageOf(line)
    if (message !== null) visit(message)
  })
  return nextOffset
}

function messageOf(text: string): TranscriptMessage | null {
  if (text.length > MAX_LINE_CHARS) return null
  let entry: unknown
  try {
    entry = JSON.parse(text)
  } catch {
    return null
  }
  return typeof entry === 'object' && entry !== null ? toMessage(entry as Record<string, unknown>) : null
}
