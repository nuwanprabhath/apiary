import type { TranscriptMessage } from '@shared/types'

/** A transcript holds at most this many, then drops down to `HELD_KEEP`: the oldest while following the newest, the newest while reading history. */
export const HELD_MAX = 600
export const HELD_KEEP = 500

const isToolResultOnly = (m: TranscriptMessage): boolean =>
  m.blocks.length > 0 && m.blocks.every((b) => b.type === 'tool_result')

/**
 * Bounds the held messages: past `HELD_MAX`, the oldest go until about `HELD_KEEP` remain, and the
 * "load earlier" cursor moves to the first one kept so the dropped ones load back from disk.
 * The cut moves later until the first kept message has a line index (the cursor needs one) and is
 * not a tool result whose call was dropped. If no such cut exists nothing is trimmed.
 */
export function windowHeld(
  messages: TranscriptMessage[],
  cursor: number | null,
  drop: 'oldest' | 'newest' = 'oldest',
): { messages: TranscriptMessage[]; cursor: number | null } {
  if (messages.length <= HELD_MAX) return { messages, cursor }
  if (drop === 'newest') return dropNewest(messages, cursor)
  for (let cut = messages.length - HELD_KEEP; cut < messages.length; cut++) {
    const first = messages[cut]
    if (first === undefined || first.index === undefined || isToolResultOnly(first)) continue
    return { messages: messages.slice(cut), cursor: first.index }
  }
  return { messages, cursor }
}

/**
 * Reading history (earlier pages prepended): the newest go until about `HELD_KEEP` remain, and the
 * returned cursor is the "later" one, the line index of the last kept message, after which the
 * dropped ones load back (`transcriptAfter` with a limit). The cut moves earlier until the last
 * kept message has a line index.
 */
function dropNewest(messages: TranscriptMessage[], cursor: number | null): { messages: TranscriptMessage[]; cursor: number | null } {
  for (let end = HELD_KEEP; end > 0; end--) {
    const last = messages[end - 1]
    if (last?.index !== undefined) return { messages: messages.slice(0, end), cursor: last.index }
  }
  return { messages, cursor }
}
