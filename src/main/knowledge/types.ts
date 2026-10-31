import type { SessionId } from '@shared/domain/ids'
import type { DigestLookback, SessionHit } from '@shared/domain/residents'

/**
 * What Apiary knows about its sessions beyond the full-text index: references (MRs, issues,
 * tickets, links) pulled out deterministically, and topic digests a cheap model writes for each part
 * of a session. Owned by Apiary rather than by any resident, so every resident kind can ask it.
 */

export interface SessionTopic {
  id: string
  title: string
  summary: string
  keywords: string[]
  refs: string[]
  /** Transcript line range (1-based, inclusive) the topic covers. */
  startLine: number
  endLine: number
}

export interface ReadOptions {
  topicId?: string
  query?: string
  maxChars: number
}

export interface SessionKnowledge {
  /** Ranked: exact refs, then digest topics, then transcript text, then titles/branches/folders. */
  find(query: string, limit: number): Promise<SessionHit[]>
  topics(sessionId: SessionId): Promise<SessionTopic[]>
  /** User and assistant text around a topic or the query's hits, else the tail; null for an unknown session. */
  read(sessionId: SessionId, options: ReadOptions): Promise<string | null>
}

export interface DigestProgress {
  done: number
  total: number
}

/**
 * The background digester. The resident service drives it from the schedule: `resume` inside active
 * hours, `pause` outside them. It never runs two sessions at once.
 */
export interface DigestJob {
  /** `lookback` keeps the pass to sessions last active inside it (null: all); a change applies from the next pass. */
  resume(options: { model: string; lookback: DigestLookback | null; shouldPause: () => boolean }): void
  pause(): void
  /** Forget every digest and start over (Settings → Re-digest everything). */
  reset(): Promise<void>
  progress(): DigestProgress
  /** What the index holds: sessions digested and their topics. */
  indexSize(): { sessions: number; topics: number }
  /** A few words on what it is doing ("Digesting 12/840"), or null when idle. */
  onActivity(listener: (activity: string | null) => void): () => void
}
