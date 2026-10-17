import type { TranscriptMessage } from '@shared/types'

/** A transcript following the newest messages holds at most this many, then drops the oldest down to `HELD_KEEP`. */
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
): { messages: TranscriptMessage[]; cursor: number | null } {
  if (messages.length <= HELD_MAX) return { messages, cursor }
  for (let cut = messages.length - HELD_KEEP; cut < messages.length; cut++) {
    const first = messages[cut]
    if (first.index === undefined || isToolResultOnly(first)) continue
    return { messages: messages.slice(cut), cursor: first.index }
  }
  return { messages, cursor }
}
