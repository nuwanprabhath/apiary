import type { SessionHit } from '@shared/domain/residents'
import { refsInQuery } from '../knowledge/refs'

/**
 * Which of the index's matches a message gets at once: only `ref` hits when it names a ref
 * (`!1175`, `ABC-123`, an MR link), the top three when it asks to find or open a session, and
 * none otherwise, so a question or an instruction never shows unrelated sessions.
 */
export type InstantMatchPolicy = { kind: 'none' } | { kind: 'refs' } | { kind: 'lookup'; words: string[] }

/** Words and phrases that ask for a session. */
const LOOKUP_RE = /\b(open|find|bring up|show me|pull up|which session|where did|where was|the session|look for)\b/i
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'we', 'i', 'me', 'my', 'it', 'is', 'was', 'that',
  'where', 'which', 'what', 'session', 'sessions', 'open', 'find', 'bring', 'up', 'show', 'pull', 'look', 'did', 'can', 'you', 'please',
])

export function instantMatchPolicy(text: string): InstantMatchPolicy {
  if (refsInQuery(text).length > 0) return { kind: 'refs' }
  if (!LOOKUP_RE.test(text)) return { kind: 'none' }
  const words = (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !STOP_WORDS.has(w))
  return { kind: 'lookup', words }
}

/** The hits a policy keeps: a `title` hit only when its title has every word the message asked for. */
export function instantHits(policy: InstantMatchPolicy, hits: readonly SessionHit[]): SessionHit[] {
  if (policy.kind === 'none') return []
  if (policy.kind === 'refs') return hits.filter((h) => h.reason === 'ref')
  return hits.filter((h) => {
    if (h.reason !== 'title') return true
    const title = h.title.toLowerCase()
    return policy.words.every((w) => title.includes(w))
  }).slice(0, 3)
}
