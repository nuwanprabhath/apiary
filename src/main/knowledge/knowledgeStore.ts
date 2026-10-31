import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { toMatchQuery } from '../search/searchIndex'
import type { SessionTopic } from './types'

/**
 * The topic digests, in a database of their own: unlike the search index they cost the user's
 * quota to make, so a search rebuild must never reach them.
 */

export interface DigestState {
  lastLine: number
  size: number
  model: string
  at: number
  failedAt: number | null
}

export interface TopicHit {
  sessionId: string
  topicId: string
  title: string
  snippet: string
  startLine: number
  endLine: number
}

interface TopicRow {
  sessionId: string
  topicId: string
  title: string
  summary: string
  keywords: string
  refs: string
  startLine: number
  endLine: number
}

const TOPIC_COLUMNS = `session_id AS sessionId, topic_id AS topicId, title, summary, keywords, refs,
  CAST(start_line AS INTEGER) AS startLine, CAST(end_line AS INTEGER) AS endLine`

const toTopic = (r: TopicRow): SessionTopic => ({
  id: r.topicId,
  title: r.title,
  summary: r.summary,
  keywords: r.keywords === '' ? [] : r.keywords.split('\n'),
  refs: r.refs === '' ? [] : r.refs.split('\n'),
  startLine: r.startLine,
  endLine: r.endLine,
})

export class KnowledgeStore {
  private db: Database.Database

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS topics USING fts5(
        session_id UNINDEXED,
        topic_id UNINDEXED,
        title,
        summary,
        keywords,
        refs,
        start_line UNINDEXED,
        end_line UNINDEXED,
        tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE TABLE IF NOT EXISTS digested (
        session_id TEXT PRIMARY KEY,
        last_line INTEGER NOT NULL,
        size INTEGER NOT NULL,
        model TEXT NOT NULL,
        at INTEGER NOT NULL,
        failed_at INTEGER
      );
    `)
  }

  state(sessionId: string): DigestState | null {
    const row = this.db
      .prepare('SELECT last_line AS lastLine, size, model, at, failed_at AS failedAt FROM digested WHERE session_id = ?')
      .get(sessionId) as DigestState | undefined
    return row ?? null
  }

  /** Adds a window's topics and moves the session's progress, in one commit. */
  record(
    sessionId: string, topics: Omit<SessionTopic, 'id'>[], progress: Omit<DigestState, 'failedAt'>,
  ): void {
    this.db.transaction(() => {
      const insert = this.db.prepare(`INSERT INTO topics
        (session_id, topic_id, title, summary, keywords, refs, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      topics.forEach((t, i) => {
        insert.run(
          sessionId, `${String(t.startLine)}-${String(t.endLine)}-${String(i)}`, t.title, t.summary,
          t.keywords.join('\n'), t.refs.join('\n'), t.startLine, t.endLine,
        )
      })
      this.db.prepare(`INSERT INTO digested (session_id, last_line, size, model, at, failed_at) VALUES (?, ?, ?, ?, ?, NULL)
        ON CONFLICT(session_id) DO UPDATE SET last_line = excluded.last_line, size = excluded.size,
          model = excluded.model, at = excluded.at, failed_at = NULL`)
        .run(sessionId, progress.lastLine, progress.size, progress.model, progress.at)
    })()
  }

  /** Keeps what was digested so far; only the retry time moves. */
  markFailed(sessionId: string, model: string, at: number): void {
    this.db.prepare(`INSERT INTO digested (session_id, last_line, size, model, at, failed_at) VALUES (?, 0, 0, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET failed_at = excluded.failed_at`)
      .run(sessionId, model, at, at)
  }

  topicsOf(sessionId: string): SessionTopic[] {
    const rows = this.db
      .prepare(`SELECT ${TOPIC_COLUMNS} FROM topics WHERE session_id = ? ORDER BY CAST(start_line AS INTEGER), CAST(end_line AS INTEGER)`)
      .all(sessionId) as TopicRow[]
    return rows.map(toTopic)
  }

  topic(sessionId: string, topicId: string): SessionTopic | null {
    const row = this.db
      .prepare(`SELECT ${TOPIC_COLUMNS} FROM topics WHERE session_id = ? AND topic_id = ?`)
      .get(sessionId, topicId) as TopicRow | undefined
    return row === undefined ? null : toTopic(row)
  }

  /**
   * Topics matching a question, best first. All the words must match; a question that nothing
   * matches word for word is tried again with any of them, since people describe a topic in
   * words that are only partly the digest's.
   */
  search(raw: string, limit: number): TopicHit[] {
    const strict = toMatchQuery(raw)
    if (strict === null) return []
    const run = (match: string): TopicHit[] => {
      try {
        return this.db.prepare(`
          SELECT session_id AS sessionId, topic_id AS topicId, title,
            snippet(topics, 3, '«', '»', '…', 16) AS snippet,
            CAST(start_line AS INTEGER) AS startLine, CAST(end_line AS INTEGER) AS endLine
          FROM topics WHERE topics MATCH ? ORDER BY rank LIMIT ?
        `).all(match, limit) as TopicHit[]
      } catch {
        return []
      }
    }
    const hits = run(strict)
    return hits.length > 0 || !strict.includes(' AND ') ? hits : run(strict.replaceAll(' AND ', ' OR '))
  }

  digestedCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM digested WHERE failed_at IS NULL AND last_line > 0').get() as { n: number }
    return row.n
  }

  topicCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM topics').get() as { n: number }
    return row.n
  }

  clear(): void {
    this.db.exec('DELETE FROM topics; DELETE FROM digested;')
  }

  close(): void {
    this.db.close()
  }
}
