import type { TranscriptMessage } from '@shared/types'

/**
 * Merges a freshly-fetched "latest page" (the tail of the session file, as returned by
 * `window.apiary.transcript(sessionId)` with no cursor) into the messages we already have.
 *
 * The latest page and our existing `messages` array are both windows onto the same append-only
 * JSONL file, so whatever overlap exists between them is necessarily *contiguous*: the last N
 * messages we already hold are exactly the first N messages of the new page, for whatever N the
 * two windows happen to share. We find the largest such N and append only what comes after it.
 *
 * Comparing by uuid alone (as the naming of this merge might suggest) isn't enough — some
 * messages have an empty uuid and can't be deduplicated that way. Because we only ever compare
 * messages that sit at *corresponding* tail/head positions (never arbitrary pairs from across
 * the whole transcript), it's safe to fall back to a structural (JSON) comparison whenever either
 * side is missing a uuid: two unrelated empty-uuid messages landing at the same relative offset
 * in two overlapping tail windows is not a real-world concern for a chat transcript.
 *
 * UI-8: pulled out of `Transcript.tsx` so this — the thing that decides whether a live-refresh
 * tick actually changes anything, and therefore whether every `MessageRow` below it gets a chance
 * to bail via `memo` — has a unit test of its own instead of being exercised only incidentally
 * through the component tests that render a whole `Transcript`.
 */
export function mergeLatestPage(
  existing: TranscriptMessage[],
  incoming: TranscriptMessage[],
): TranscriptMessage[] {
  const sameMessage = (a: TranscriptMessage, b: TranscriptMessage): boolean => {
    if (a.uuid.length > 0 || b.uuid.length > 0) return a.uuid === b.uuid
    return JSON.stringify(a) === JSON.stringify(b)
  }

  const maxOverlap = Math.min(existing.length, incoming.length)
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    const existingTail = existing.slice(existing.length - overlap)
    const incomingHead = incoming.slice(0, overlap)
    if (existingTail.every((m, i) => sameMessage(m, incomingHead[i]))) {
      // Found the overlap boundary: everything in `incoming` past it is genuinely new.
      return overlap < incoming.length ? [...existing, ...incoming.slice(overlap)] : existing
    }
  }
  // No overlap found at all. In practice this means the whole incoming page is newer than
  // everything we have (e.g. a burst of activity larger than one page landed between refreshes)
  // — appending everything is exactly right in that case. The only way this branch mis-fires is
  // if the underlying file were rewritten out from under us, which the append-only session log
  // never does; appending is still the safer failure mode than silently dropping messages.
  return [...existing, ...incoming]
}
