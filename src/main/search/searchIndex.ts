import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Full-text search over what was actually said in a session.
 *
 * Kept in a database of its own rather than alongside the session store. An index over months of
 * transcripts is much larger than the metadata it sits beside, is derived data that can always be
 * rebuilt from the JSONL files, and has a schema that will change as search improves — so it gets
 * its own file, which can be deleted wholesale without touching anything the app cannot recreate.
 *
 * **Tokenisation is the whole design.** The searches this exists to serve are for identifiers:
 * `!1257`, `#2902`, `2260-remove-prefill`. The default `unicode61` tokeniser splits on punctuation,
 * which is exactly what makes those work — `!1257` indexes as the token `1257`, so both `!1257` and
 * `1257` find it, and `2260-remove-prefill` indexes as three tokens, so the whole branch name finds
 * it *and* so does `prefill` on its own. Adding `-` or `!` to `tokenchars` would make each of those
 * one indivisible token, which buys exactness on the full string at the cost of every partial
 * search anyone would actually type. Queries are put through the same shape (see `toMatchQuery`),
 * so what the user types and what was indexed agree.
 */

/** A session that matched, with the highest-ranked passage from it. */
export interface SearchHit {
  sessionId: string
  /** A short excerpt around the match, with the matched terms wrapped in «». */
  snippet: string
}

/**
 * Per-session cap on indexed text. A handful of very long sessions would otherwise dominate both
 * the index's size and the time the first pass takes, for material nobody searches for: what people
 * remember and search by turns up in what was said, not in the thousandth tool result.
 */
const MAX_TEXT_PER_SESSION = 2 * 1024 * 1024

/**
 * Turns what someone typed into an FTS5 MATCH expression.
 *
 * FTS5's query language treats `!`, `#`, `-`, `*` and quotes as syntax, so a raw query like
 * `!1257` is a syntax error rather than a search. Everything is therefore reduced to bare tokens
 * the same way the tokeniser reduces the indexed text, then quoted and ANDed. The final token gets
 * a `*` so the results narrow as you type rather than only on word boundaries.
 *
 * Returns null when there is nothing left to search for, which the caller reads as "no query".
 */
export function toMatchQuery(raw: string): string | null {
  const tokens = raw.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t !== '')
  if (tokens.length === 0) return null
  return tokens
    .map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`))
    .join(' AND ')
}

export class SearchIndex {
  private db: Database.Database

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    // WAL so a read during indexing is never blocked by the write in progress; the index is
    // rebuildable, so the durability trade-off of NORMAL is free here in a way it would not be
    // for the session store.
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
        session_id UNINDEXED,
        body,
        tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE TABLE IF NOT EXISTS indexed (
        session_id TEXT PRIMARY KEY,
        size INTEGER NOT NULL,
        mtime INTEGER NOT NULL
      );
      /*
       * Notes are a table of their own rather than more text appended to the chunks table.
       *
       * A note is written by hand and changes on its own schedule, while chunks is keyed to a
       * transcript's size and mtime — so folding notes into it would mean either re-reading a
       * whole JSONL to record a one-line note, or an entry whose freshness check no longer
       * describes what is in it. Separating them also makes the two searchable independently,
       * which is what lets notes stay on when transcript indexing is turned off.
       */
      CREATE VIRTUAL TABLE IF NOT EXISTS notes USING fts5(
        session_id UNINDEXED,
        body,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `)
  }

  /**
   * Whether this session's file has changed since it was last indexed.
   *
   * Size and mtime rather than a hash: session files are append-only and reach tens of megabytes,
   * so hashing them to find out whether to read them would cost more than the indexing does.
   */
  needsIndexing(sessionId: string, size: number, mtimeMs: number): boolean {
    const row = this.db
      .prepare('SELECT size, mtime FROM indexed WHERE session_id = ?')
      .get(sessionId) as { size: number; mtime: number } | undefined
    return row === undefined || row.size !== size || row.mtime !== Math.floor(mtimeMs)
  }

  /** Replaces everything indexed for one session. */
  put(sessionId: string, text: string, size: number, mtimeMs: number): void {
    const write = this.db.transaction(() => {
      this.db.prepare('DELETE FROM chunks WHERE session_id = ?').run(sessionId)
      this.db.prepare('INSERT INTO chunks (session_id, body) VALUES (?, ?)')
        .run(sessionId, text.slice(0, MAX_TEXT_PER_SESSION))
      this.db.prepare('INSERT OR REPLACE INTO indexed (session_id, size, mtime) VALUES (?, ?, ?)')
        .run(sessionId, size, Math.floor(mtimeMs))
    })
    write()
  }

  /** Replaces the indexed note for one session. An empty or absent note removes the entry. */
  putNote(sessionId: string, note: string | null): void {
    const write = this.db.transaction(() => {
      this.db.prepare('DELETE FROM notes WHERE session_id = ?').run(sessionId)
      const trimmed = note?.trim() ?? ''
      if (trimmed !== '') {
        this.db.prepare('INSERT INTO notes (session_id, body) VALUES (?, ?)')
          .run(sessionId, trimmed.slice(0, MAX_TEXT_PER_SESSION))
      }
    })
    write()
  }

  /** Session ids whose *note* matches. Separate from `search` so the two can be enabled apart. */
  searchNotes(raw: string, limit = 200): SearchHit[] {
    const match = toMatchQuery(raw)
    if (match === null) return []
    try {
      return this.db.prepare(`
        SELECT session_id AS sessionId, snippet(notes, 1, '«', '»', '…', 12) AS snippet
        FROM notes
        WHERE notes MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(match, limit) as SearchHit[]
    } catch {
      return []
    }
  }

  /** Empties only the notes, for when note indexing is switched off. */
  clearNotes(): void {
    this.db.exec('DELETE FROM notes')
  }

  /** How many notes are indexed — shown in Settings beside the transcript count. */
  noteCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }
    return row.n
  }

  /** Drops a session from the index — used when it is removed from view. */
  forget(sessionId: string): void {
    const write = this.db.transaction(() => {
      this.db.prepare('DELETE FROM chunks WHERE session_id = ?').run(sessionId)
      this.db.prepare('DELETE FROM indexed WHERE session_id = ?').run(sessionId)
      this.db.prepare('DELETE FROM notes WHERE session_id = ?').run(sessionId)
    })
    write()
  }

  /** Empties the index, so the next pass rebuilds it from scratch. */
  clear(): void {
    this.db.exec('DELETE FROM chunks; DELETE FROM indexed; DELETE FROM notes;')
  }

  /** Session ids whose conversation matches, best first. */
  search(raw: string, limit = 200): SearchHit[] {
    const match = toMatchQuery(raw)
    if (match === null) return []
    try {
      const rows = this.db.prepare(`
        SELECT session_id AS sessionId, snippet(chunks, 1, '«', '»', '…', 12) AS snippet
        FROM chunks
        WHERE chunks MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(match, limit) as SearchHit[]
      return rows
    } catch {
      // A query that FTS5 still refuses (an unbalanced construct we did not anticipate) should
      // read as "nothing matched" rather than breaking the search box as you type.
      return []
    }
  }

  /** How many sessions are currently indexed — shown in Settings so the state is visible. */
  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM indexed').get() as { n: number }
    return row.n
  }

  close(): void {
    this.db.close()
  }
}
