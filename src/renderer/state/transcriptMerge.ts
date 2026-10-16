import type { TranscriptMessage } from '@shared/types'

/**
 * Merges a freshly-fetched "latest page" (the tail of the session file, from
 * `window.apiary.transcript(sessionId)` with no cursor) into the messages already held.
 *
 * Both are windows onto the same append-only JSONL, so their overlap is contiguous: the last N
 * held messages are the first N of the new page. The largest such N is found and only what follows
 * it is appended.
 *
 * Some messages have an empty uuid, so when either side lacks one the comparison is structural
 * (JSON). That is safe because only messages at corresponding tail/head positions are compared.
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
      return overlap < incoming.length ? [...existing, ...incoming.slice(overlap)] : existing
    }
  }
  // No overlap: the whole page is newer than what is held (a burst larger than one page landed
  // between refreshes), so appending everything is right.
  return [...existing, ...incoming]
}
