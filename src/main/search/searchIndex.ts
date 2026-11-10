import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { log } from '../log/logger'
import type { Ref } from '../knowledge/refs'

/**
 * Full-text search over what was actually said in a session.
 *
 * Kept in a database of its own: derived data, much larger than the session store, that can be
 * deleted wholesale and rebuilt from the JSONL files.
 *
 * **Tokenisation is the whole design.** Searches are for identifiers: `!1257`, `#2902`,
 * `2260-remove-prefill`. The default `unicode61` tokeniser splits on punctuation, so `!1257` indexes
 * as `1257` and the branch name as three tokens, and `prefill` alone finds it. Adding `-` or `!` to
 * `tokenchars` would make each an indivisible token and break partial search. Queries go through
 * the same reduction (see `toMatchQuery`).
 */

/** A session that matched, with the highest-ranked passage from it. */
export interface SearchHit {
  sessionId: string
  /** A short excerpt around the match, with the matched terms wrapped in «». */
  snippet: string
}

/** Per-session cap on indexed text, so a few very long sessions do not dominate index size and first-pass time. */
export const MAX_TEXT_PER_SESSION = 2 * 1024 * 1024

/** One row of `chunks` holds at most this much text. */
export const CHUNK_CHARS = 256 * 1024

/** What `SearchIndex.write` stores for one session. */
export interface IndexWrite {
  /** New text, in order, each at most `CHUNK_CHARS`. */
  chunks: string[]
  refs: Ref[]
  size: number
  mtimeMs: number
  /** Byte offset just past the last whole line indexed. */
  upto: number
  /** True: forget what the session had and start from these chunks. */
  reset: boolean
}

/** Splits text into rows of at most `CHUNK_CHARS`. */
function splitChunks(text: string): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += CHUNK_CHARS) out.push(text.slice(i, i + CHUNK_CHARS))
  return out
}

/** Above this, `put`'s synchronous FTS5 tokenisation (on the main thread) is worth a log line
 *  (measure before cutting anything here). */
const PUT_SLOW_MS = 50

/**
 * Turns what someone typed into an FTS5 MATCH expression.
 *
 * FTS5 treats `!`, `#`, `-`, `*` and quotes as syntax, so a raw `!1257` is a syntax error. Input is
 * reduced to bare tokens the way the tokeniser reduces indexed text, then quoted and ANDed. The
 * final token gets a `*` once it is long enough (see MIN_PREFIX_CHARS).
 *
 * Returns null when there is nothing left to search for, which the caller reads as "no query".
 */
/**
 * How long the final token must be before it is searched as a prefix.
 *
 * A prefix term makes FTS5 walk every token starting with it, so the first letter is the most
 * expensive query. Measured on a real library: `"t"*` took **7.7 seconds**, `"te"*` 143ms, a whole
 * word single-digit ms. `better-sqlite3` is synchronous, so that froze typing in every window.
 *
 * Below three characters the token is searched exactly, not as a prefix; titles, paths and
 * branches are filtered in the renderer, so a short query still narrows the sidebar.
 */
const MIN_PREFIX_CHARS = 3

/** The words of a query, lowercased, the way the tokeniser would split indexed text. */
export function queryTokens(raw: string): string[] {
  return raw.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t !== '')
}

export function toMatchQuery(raw: string): string | null {
  const tokens = queryTokens(raw)
  if (tokens.length === 0) return null
  return tokens
    .map((t, i) => (
      i === tokens.length - 1 && t.length >= MIN_PREFIX_CHARS ? `"${t}"*` : `"${t}"`
    ))
    .join(' AND ')
}

export class SearchIndex {
  private db: Database.Database

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    // WAL so a read during indexing is not blocked by the write; NORMAL durability is fine for a rebuildable index.
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    const hadRefs = this.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'refs'").get() !== undefined
    const hadIndexed = this.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'indexed'").get() !== undefined
    // A chunks table without `seq` predates chunked sessions: drop it and what says it was indexed,
    // so the next pass rebuilds every session.
    const chunkColumns = this.db.prepare("PRAGMA table_info('chunks')").all() as { name: string }[]
    if (chunkColumns.length > 0 && !chunkColumns.some((c) => c.name === 'seq')) {
      this.db.exec('DROP TABLE chunks; DROP TABLE IF EXISTS indexed;')
    }
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
        session_id UNINDEXED,
        seq UNINDEXED,
        body,
        tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE TABLE IF NOT EXISTS indexed (
        session_id TEXT PRIMARY KEY,
        size INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        upto INTEGER NOT NULL DEFAULT 0,
        next_seq INTEGER NOT NULL DEFAULT 0
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
      /* Cheap and rebuildable like the chunks, so they live and die together (see knowledge/CLAUDE.md). */
      CREATE TABLE IF NOT EXISTS refs (session_id TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS refs_by_value ON refs (kind, value);
      CREATE INDEX IF NOT EXISTS refs_by_session ON refs (session_id);
    `)
    // An index built before refs existed has none for the sessions it holds; forgetting what it
    // indexed makes the next pass read them again.
    if (hadIndexed && !hadRefs) this.db.exec('DELETE FROM indexed')
  }

  /** Whether this session's file has changed since it was last indexed: size and mtime, since hashing tens of megabytes costs more than indexing. */
  needsIndexing(sessionId: string, size: number, mtimeMs: number): boolean {
    const row = this.db
      .prepare('SELECT size, mtime FROM indexed WHERE session_id = ?')
      .get(sessionId) as { size: number; mtime: number } | undefined
    return row === undefined || row.size !== size || row.mtime !== Math.floor(mtimeMs)
  }

  /** Where a session's indexing stands, for reading only what a file added. */
  indexState(sessionId: string): { size: number; upto: number } | undefined {
    return this.db.prepare('SELECT size, upto FROM indexed WHERE session_id = ?').get(sessionId) as
      { size: number; upto: number } | undefined
  }

  /** Replaces a session with `text`, whole. */
  put(sessionId: string, text: string, size: number, mtimeMs: number, refs: Ref[] = []): void {
    this.write(sessionId, { chunks: splitChunks(text), refs, size, mtimeMs, upto: size, reset: true })
  }

  /**
   * Adds chunks to a session (or restarts it), then drops its oldest chunks while its stored text
   * is over `MAX_TEXT_PER_SESSION`. The first chunk stays, so the opening prompt is searchable.
   */
  write(sessionId: string, entry: IndexWrite): void {
    let textLength = 0
    const run = this.db.transaction(() => {
      if (entry.reset) {
        this.db.prepare('DELETE FROM chunks WHERE session_id = ?').run(sessionId)
        this.db.prepare('DELETE FROM refs WHERE session_id = ?').run(sessionId)
      }
      const state = this.db.prepare('SELECT next_seq AS nextSeq FROM indexed WHERE session_id = ?')
        .get(sessionId) as { nextSeq: number } | undefined
      let seq = entry.reset || state === undefined ? 0 : state.nextSeq
      const add = this.db.prepare('INSERT INTO chunks (session_id, seq, body) VALUES (?, ?, ?)')
      for (const chunk of entry.chunks) {
        add.run(sessionId, seq, chunk)
        seq += 1
        textLength += chunk.length
      }
      this.db.prepare('INSERT OR REPLACE INTO indexed (session_id, size, mtime, upto, next_seq) VALUES (?, ?, ?, ?, ?)')
        .run(sessionId, entry.size, Math.floor(entry.mtimeMs), entry.upto, seq)
      const have = new Set((this.db.prepare('SELECT kind, value FROM refs WHERE session_id = ?').all(sessionId) as Ref[])
        .map((r) => `${r.kind}|${r.value}`))
      const addRef = this.db.prepare('INSERT INTO refs (session_id, kind, value) VALUES (?, ?, ?)')
      for (const ref of entry.refs) {
        if (!have.has(`${ref.kind}|${ref.value}`)) addRef.run(sessionId, ref.kind, ref.value)
      }
      this.trim(sessionId)
    })
    const started = Date.now()
    run()
    // Tokenising happens synchronously on the main thread.
    const durationMs = Date.now() - started
    if (durationMs > PUT_SLOW_MS) {
      log.debug('search', 'slow index write', { sessionId, durationMs, textLength })
    }
  }

  private trim(sessionId: string): void {
    const rows = this.db.prepare('SELECT seq, length(body) AS len FROM chunks WHERE session_id = ? ORDER BY seq')
      .all(sessionId) as { seq: number; len: number }[]
    let total = rows.reduce((sum, r) => sum + r.len, 0)
    const drop = this.db.prepare('DELETE FROM chunks WHERE session_id = ? AND seq = ?')
    for (const row of rows.slice(1)) {
      if (total <= MAX_TEXT_PER_SESSION) break
      drop.run(sessionId, row.seq)
      total -= row.len
    }
  }

  /** An empty or absent note removes the entry. */
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

  /** Session ids whose *note* matches. */
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

  clearNotes(): void {
    this.db.exec('DELETE FROM notes')
  }

  /** Replaces every indexed note in one commit; separate clear and insert would let the search worker (a WAL reader) see an empty table. */
  replaceNotes(entries: { sessionId: string; note: string }[]): void {
    const write = this.db.transaction(() => {
      this.db.exec('DELETE FROM notes')
      const insert = this.db.prepare('INSERT INTO notes (session_id, body) VALUES (?, ?)')
      for (const { sessionId, note } of entries) {
        const trimmed = note.trim()
        if (trimmed !== '') insert.run(sessionId, trimmed.slice(0, MAX_TEXT_PER_SESSION))
      }
    })
    write()
  }

  noteCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }
    return row.n
  }

  forget(sessionId: string): void {
    const write = this.db.transaction(() => {
      this.db.prepare('DELETE FROM chunks WHERE session_id = ?').run(sessionId)
      this.db.prepare('DELETE FROM indexed WHERE session_id = ?').run(sessionId)
      this.db.prepare('DELETE FROM refs WHERE session_id = ?').run(sessionId)
      this.db.prepare('DELETE FROM notes WHERE session_id = ?').run(sessionId)
    })
    write()
  }

  clear(): void {
    this.db.exec('DELETE FROM chunks; DELETE FROM indexed; DELETE FROM refs; DELETE FROM notes;')
  }

  /** Session ids whose conversation matches, best first. */
  search(raw: string, limit = 200): SearchHit[] {
    const match = toMatchQuery(raw)
    if (match === null) return []
    try {
      // A session has several rows; ask for more than `limit` and keep each session's best.
      const rows = this.db.prepare(`
        SELECT session_id AS sessionId, snippet(chunks, 2, '«', '»', '…', 12) AS snippet
        FROM chunks
        WHERE chunks MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(match, limit * 8) as SearchHit[]
      const best = new Map<string, SearchHit>()
      for (const row of rows) if (!best.has(row.sessionId)) best.set(row.sessionId, row)
      return [...best.values()].slice(0, limit)
    } catch {
      // A query FTS5 still refuses reads as "nothing matched".
      return []
    }
  }

  /** Sessions that mentioned any of these refs, most-matched first. */
  sessionsWithRefs(refs: Ref[]): string[] {
    if (refs.length === 0) return []
    const find = this.db.prepare('SELECT session_id AS sessionId FROM refs WHERE kind = ? AND value = ?')
    const counts = new Map<string, number>()
    for (const ref of refs) {
      for (const row of find.all(ref.kind, ref.value) as { sessionId: string }[]) {
        counts.set(row.sessionId, (counts.get(row.sessionId) ?? 0) + 1)
      }
    }
    return [...counts].sort((a, b) => b[1] - a[1]).map(([id]) => id)
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM indexed').get() as { n: number }
    return row.n
  }

  close(): void {
    this.db.close()
  }
}
