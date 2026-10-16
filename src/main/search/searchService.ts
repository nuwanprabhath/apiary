import type { SearchIndex } from './searchIndex'
import type { SearchClient } from './searchClient'
import { errorMessage } from '@shared/errors'
import { log } from '../log/logger'
import { runIndexPass, type IndexableSession } from './indexer'
import type { SessionStore } from '../store/sessionStore'

export interface SearchServiceDeps {
  store: SessionStore
  /** Opens the full-text index; called on first use, never at construction. Built in the container. */
  createIndex: () => SearchIndex
  /** Starts the search worker on the same index file (its own handle); called on the first search, never at construction. Built in the container. */
  createClient: () => SearchClient
  searchChatContent?: boolean
  searchSessionNotes?: boolean
  /** Called after an index pass that changed something, so a search typed mid-pass can be re-queried. */
  onIndexUpdated?: () => void
  /** Whether `AppService` has started disposing; checked before starting or continuing a pass. */
  isDisposed: () => boolean
}

/**
 * Content and note search: index/client lifecycle, note sync, rebuild, counts and
 * `updateSearchIndex`; see `tests/unit/searchService.test.ts`.
 */
export class SearchService {
  private readonly store: SessionStore
  private readonly onIndexUpdated: (() => void) | undefined
  private readonly isDisposed: () => boolean
  /** The full-text index, created on first use: content search can be switched off in Settings. */
  private searchIndex: SearchIndex | null = null
  /** Owns the worker thread the content search runs on — see `search`. */
  private searchClient: SearchClient | null = null
  private searchChatContent: boolean
  private searchSessionNotes: boolean
  /** The in-flight indexing pass, if any — awaited by a rebuild so it never races the clear below. */
  private indexPass: Promise<void> | null = null

  private readonly createIndex: () => SearchIndex
  private readonly createClient: () => SearchClient

  constructor(deps: SearchServiceDeps) {
    this.createIndex = deps.createIndex
    this.createClient = deps.createClient
    this.store = deps.store
    this.onIndexUpdated = deps.onIndexUpdated
    this.isDisposed = deps.isDisposed
    this.searchChatContent = deps.searchChatContent ?? true
    this.searchSessionNotes = deps.searchSessionNotes ?? true
  }

  /**
   * Which sessions match `query` by conversation content or by note.
   *
   * Runs in a worker thread (`SearchClient`): `better-sqlite3` is synchronous, so an inline FTS
   * query froze typing in every window. See `searchWorker.ts` and `searchIndex.ts`.
   */
  async search(query: string): Promise<string[]> {
    if (!this.searchChatContent && !this.searchSessionNotes) return []
    this.searchClient ??= this.createClient()
    const fromWorker = await this.searchClient.search(query, {
      content: this.searchChatContent,
      notes: this.searchSessionNotes,
    })
    if (fromWorker !== null) return fromWorker

    // No worker: search in-process (blocks the main thread; `SearchClient` logs when it cannot start
    // one). The integration tests take this path, with no bundled worker beside the source.
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
      return []
    }
  }

  private index(): SearchIndex {
    this.searchIndex ??= this.createIndex()
    return this.searchIndex
  }

  setChatContentEnabled(enabled: boolean): void {
    // A non-boolean is a caller that does not know this setting, not a request to turn it off.
    if (typeof enabled !== 'boolean') return
    this.searchChatContent = enabled
  }

  /**
   * Turns note indexing on or off.
   *
   * Switching it off empties the note index rather than ignoring it. Switching it back on
   * repopulates from the session store, which is cheap: no transcript is re-read.
   */
  setSessionNotesEnabled(enabled: boolean): void {
    // Guarded first: a stray `undefined` would count as "off" and empty the note index.
    if (typeof enabled !== 'boolean') return
    if (enabled === this.searchSessionNotes) return
    this.searchSessionNotes = enabled
    try {
      if (!enabled) this.index().clearNotes()
      else this.syncNoteIndex()
    } catch (e) {
      // The note index is derived data; failing to reshape it must not fail the settings save.
      log.warn('search', 'could not reshape the note index', { error: errorMessage(e) })
    }
  }

  /** Rewrites the note index from the store in one commit: on switch-on, and in every refresh pass. */
  private syncNoteIndex(): void {
    this.index().replaceNotes(this.store.sessionsWithNotes())
  }

  /**
   * Keeps the note index in step with a note `AppService.setSessionNote` just wrote, so it is
   * searchable at once. A failure is swallowed: the note is saved in the store.
   */
  putNoteIfEnabled(sessionId: string, note: string | null): void {
    if (!this.searchSessionNotes) return
    try {
      this.index().putNote(sessionId, note)
    } catch (e) {
      log.warn('search', 'could not index a note', { error: errorMessage(e) })
    }
  }

  /** Wipes the index so the next pass rebuilds it — the "Rebuild index" action in Settings. */
  async rebuild(): Promise<void> {
    if (!this.searchChatContent && !this.searchSessionNotes) return
    // Let a running pass finish first: clearing under it would leave what it already walked past
    // missing, and `ApiaryApi.searchRebuild` promises a full rebuild once it resolves.
    // `runSearchIndexPass` logs its own failure, so the pass promise never rejects.
    if (this.indexPass) await this.indexPass
    this.index().clear()
    if (this.searchSessionNotes) this.syncNoteIndex()
    await this.runSearchIndexPass()
  }

  /** How many sessions are indexed. */
  indexCount(): number {
    return this.searchChatContent ? this.index().count() : 0
  }

  /** How many notes are indexed. */
  noteCount(): number {
    return this.searchSessionNotes ? this.index().noteCount() : 0
  }

  /**
   * Brings the index up to date for every imported session.
   *
   * Never awaited by `AppService.refresh()`, so Refresh is not as slow as the index. The
   * `indexPass` guard stops overlapping refreshes racing over the same files.
   */
  async update(): Promise<void> {
    // Also picks up a note written before indexing was switched on.
    if (this.searchSessionNotes && !this.isDisposed()) {
      try {
        this.syncNoteIndex()
      } catch (e) {
        // Derived data; the next pass tries again.
        log.warn('search', 'could not sync the note index', { error: errorMessage(e) })
      }
    }
    if (!this.searchChatContent || this.indexPass || this.isDisposed()) return
    await this.runSearchIndexPass()
  }

  /** Runs one indexing pass, tracked as a promise so `rebuild` can await it. */
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
      } catch (e) {
        // A failed pass leaves the index as it was; the next refresh tries again.
        log.warn('search', 'index pass failed', { error: errorMessage(e) })
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
   * Closes the index and the search worker's SQLite handle; called from `AppService.dispose()`.
   * `isDisposed()` stops a running pass between files, so this waits on nothing.
   */
  async close(): Promise<void> {
    this.searchIndex?.close()
    this.searchIndex = null
    await this.searchClient?.close()
    this.searchClient = null
  }
}
