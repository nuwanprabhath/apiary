import { SearchIndex } from './searchIndex'
import { SearchClient } from './searchClient'
import { runIndexPass, type IndexableSession } from './indexer'
import type { SessionStore } from '../store/sessionStore'

export interface SearchServiceDeps {
  store: SessionStore
  /** Where the full-text index lives. */
  dbPath: string
  searchChatContent?: boolean
  searchSessionNotes?: boolean
  /**
   * Called after an index pass that actually changed something. Indexing runs behind whatever the
   * user is doing, so a search typed while it was still running would otherwise sit on results
   * that were incomplete at the moment they were fetched, with nothing to prompt a re-query.
   */
  onIndexUpdated?: () => void
  /** Whether `AppService` has started disposing — checked before starting or continuing a pass,
   *  so nothing here runs against a store or index that is about to close. Owned by `AppService`,
   *  read here rather than duplicated. */
  isDisposed: () => boolean
}

/**
 * Content and note search: index/client lifecycle, note sync, rebuild, counts and
 * `updateSearchIndex` (MAIN-14 step 4) — pure move out of `AppService`. Behaviour, ordering and
 * every comment explaining a past bug (the 7.7s main-thread freeze, MAIN-7's note-index rewrite,
 * MAIN-8's overlapping-pass race) are unchanged; see `tests/unit/searchService.test.ts`.
 */
export class SearchService {
  private readonly store: SessionStore
  private readonly dbPath: string
  private readonly onIndexUpdated: (() => void) | undefined
  private readonly isDisposed: () => boolean
  /**
   * The full-text index, created on first use. Lazy because it is only worth the file handle and
   * the schema when content search is actually on, and it can be switched off in Settings.
   */
  private searchIndex: SearchIndex | null = null
  /** Owns the worker thread the content search runs on — see `search`. */
  private searchClient: SearchClient | null = null
  private searchChatContent: boolean
  private searchSessionNotes: boolean
  /** The in-flight indexing pass, if any — awaited by a rebuild so it never races the clear below. */
  private indexPass: Promise<void> | null = null

  constructor(deps: SearchServiceDeps) {
    this.store = deps.store
    this.dbPath = deps.dbPath
    this.onIndexUpdated = deps.onIndexUpdated
    this.isDisposed = deps.isDisposed
    this.searchChatContent = deps.searchChatContent ?? true
    this.searchSessionNotes = deps.searchSessionNotes ?? true
  }

  /**
   * Which sessions match `query` by conversation content or by note.
   *
   * Runs in a worker thread (`SearchClient`), not here. `better-sqlite3` is synchronous, so doing
   * this inline put an FTS query on the thread that also routes window input — and a slow query
   * therefore froze typing in every window rather than merely delaying results. See
   * `searchWorker.ts`; the 7.7-second case that proved it is described in `searchIndex.ts`.
   */
  async search(query: string): Promise<string[]> {
    if (!this.searchChatContent && !this.searchSessionNotes) return []
    this.searchClient ??= new SearchClient(this.dbPath)
    const fromWorker = await this.searchClient.search(query, {
      content: this.searchChatContent,
      notes: this.searchSessionNotes,
    })
    if (fromWorker !== null) return fromWorker

    // No worker available — search in-process rather than pretending nothing matched. This blocks
    // the main thread, which is the very thing the worker exists to avoid, so it is a fallback and
    // not a mode: `SearchClient` logs loudly when it cannot start one. It is also the path the
    // integration tests take, since they run the source directly with no bundled worker beside it.
    try {
      const ids = new Set<string>()
      if (this.searchChatContent) {
        for (const hit of this.index().search(query)) ids.add(hit.sessionId)
      }
      if (this.searchSessionNotes) {
        for (const hit of this.index().searchNotes(query)) ids.add(hit.sessionId)
      }
      return [...ids]
    } catch {
      // Search is an enhancement to the sidebar, never a reason for it to fail to load.
      return []
    }
  }

  /** The index, opened on first use. */
  private index(): SearchIndex {
    this.searchIndex ??= new SearchIndex(this.dbPath)
    return this.searchIndex
  }

  setChatContentEnabled(enabled: boolean): void {
    // Anything that is not a boolean is a caller that does not know about this setting, not a
    // request to turn it off. See the note on the settings merge in ipc.ts.
    if (typeof enabled !== 'boolean') return
    this.searchChatContent = enabled
  }

  /**
   * Turns note indexing on or off.
   *
   * Switching it off empties the note index rather than merely ignoring it — a search index of
   * things the user asked not to be searched should not sit on disk. Switching it back on
   * repopulates from the session store, which is the record of the notes themselves; this is
   * immediate and cheap, because a note is a line of text and no transcript has to be re-read.
   */
  setSessionNotesEnabled(enabled: boolean): void {
    // Guarded before the comparison, because the damage here is not just a flag: switching off
    // empties the note index, so a stray `undefined` would silently delete it.
    if (typeof enabled !== 'boolean') return
    if (enabled === this.searchSessionNotes) return
    this.searchSessionNotes = enabled
    try {
      if (!enabled) this.index().clearNotes()
      else this.syncNoteIndex()
    } catch {
      // The note index is derived data; failing to reshape it must not fail the settings save.
    }
  }

  /**
   * Rewrites the note index from the store in one commit (MAIN-7) — used when note indexing is
   * switched back on, and as the safety net every refresh pass runs to pick up a note written
   * before indexing was ever turned on.
   */
  private syncNoteIndex(): void {
    this.index().replaceNotes(this.store.sessionsWithNotes())
  }

  /**
   * Keeps the note index in step with a note `AppService.setSessionNote` just wrote to the store.
   * The index write happens here rather than being left to the next background pass: a note is
   * written so it can be found again, and a note that is not searchable until some later rescan is
   * a note that appears not to work. A failure here is swallowed — the note itself is already
   * saved in the store, and a rebuild recovers the index.
   */
  putNoteIfEnabled(sessionId: string, note: string | null): void {
    if (!this.searchSessionNotes) return
    try {
      this.index().putNote(sessionId, note)
    } catch {
      // Saved either way: the note lives in the session store, and a rebuild recovers the index.
    }
  }

  /** Wipes the index so the next pass rebuilds it — the "Rebuild index" action in Settings. */
  async rebuild(): Promise<void> {
    if (!this.searchChatContent && !this.searchSessionNotes) return
    // A background pass may already be walking the sessions. Let it finish first: clearing the
    // index underneath it would leave whatever it had already walked past missing afterwards, and
    // `ApiaryApi.searchRebuild` promises the index is fully rebuilt once it resolves.
    if (this.indexPass) await this.indexPass.catch(() => {})
    this.index().clear()
    // Notes come back from the store immediately; transcripts are the slow part and are left to
    // the pass below.
    if (this.searchSessionNotes) this.syncNoteIndex()
    await this.runSearchIndexPass()
  }

  /** How many sessions are indexed, for Settings to show that the index exists and is populated. */
  indexCount(): number {
    return this.searchChatContent ? this.index().count() : 0
  }

  /** How many notes are indexed, shown beside the session count in Settings. */
  noteCount(): number {
    return this.searchSessionNotes ? this.index().noteCount() : 0
  }

  /**
   * Brings the index up to date for every imported session.
   *
   * Never awaited by `AppService.refresh()`: indexing is a background chore, and a rescan that
   * waited for it would make the Refresh button as slow as the slowest thing in the index. The
   * `indexPass` guard means overlapping refreshes queue no work rather than racing each other over
   * the same files.
   */
  async update(): Promise<void> {
    // Notes are kept in step by whoever changes them, but a pass is also where a note written
    // before indexing was switched on gets picked up.
    if (this.searchSessionNotes && !this.isDisposed()) {
      try { this.syncNoteIndex() } catch { /* Derived data; the next pass tries again. */ }
    }
    if (!this.searchChatContent || this.indexPass || this.isDisposed()) return
    await this.runSearchIndexPass()
  }

  /**
   * Runs one indexing pass, tracked as a promise so `rebuild` can await whatever is already
   * running instead of racing it (MAIN-8).
   */
  private async runSearchIndexPass(): Promise<void> {
    const pass = (async () => {
      try {
        const sessions: IndexableSession[] = this.store
          .visibleSessions()
          .map((s) => ({ sessionId: s.sessionId, file: s.filePath }))
        const result = await runIndexPass(
          this.index(), sessions, () => this.isDisposed() || !this.searchChatContent,
        )
        if (result.indexed > 0 && !this.isDisposed()) this.onIndexUpdated?.()
      } catch {
        // A failed pass leaves the index as it was; the next refresh tries again.
      }
    })()
    this.indexPass = pass
    try {
      await pass
    } finally {
      if (this.indexPass === pass) this.indexPass = null
    }
  }

  /**
   * Closes the index and the search worker's own SQLite handle (MAIN-20) — called from
   * `AppService.dispose()`. `isDisposed()` already tells a running index pass to stop between
   * files, so this waits on nothing: the worst case is one file's read finishing against a handle
   * about to close.
   */
  async close(): Promise<void> {
    this.searchIndex?.close()
    this.searchIndex = null
    await this.searchClient?.close()
    this.searchClient = null
  }
}
