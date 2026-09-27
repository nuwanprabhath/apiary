import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SearchService } from '../../src/main/search/searchService'
import type { SessionStore, StoredSession } from '../../src/main/store/sessionStore'

/** A narrow fake of just the two `SessionStore` methods `SearchService` reads. */
function fakeStore(opts: {
  visible?: StoredSession[]
  withNotes?: { sessionId: string; note: string }[]
}): SessionStore {
  return {
    visibleSessions: () => opts.visible ?? [],
    sessionsWithNotes: () => opts.withNotes ?? [],
  } as unknown as SessionStore
}

describe('SearchService (MAIN-14 step 4)', () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apiary-searchservice-'))
    dbPath = join(dir, 'search.db')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('search() returns [] when both content and note search are off', async () => {
    const search = new SearchService({
      store: fakeStore({}), dbPath, searchChatContent: false, searchSessionNotes: false, isDisposed: () => false,
    })
    expect(await search.search('anything')).toEqual([])
  })

  it('putNoteIfEnabled() indexes a note, findable by search()', async () => {
    const search = new SearchService({
      store: fakeStore({}), dbPath, searchChatContent: false, searchSessionNotes: true, isDisposed: () => false,
    })
    search.putNoteIfEnabled('s1', 'remember the gitlab token rotation')
    const hits = await search.search('rotation')
    expect(hits).toContain('s1')
  })

  it('putNoteIfEnabled() is a no-op when note search is disabled', async () => {
    const search = new SearchService({
      store: fakeStore({}), dbPath, searchChatContent: false, searchSessionNotes: false, isDisposed: () => false,
    })
    search.putNoteIfEnabled('s1', 'a note nobody asked to index')
    expect(await search.search('note')).toEqual([])
  })

  it('setSessionNotesEnabled(false) empties the note index; (true) resyncs it from the store', async () => {
    const store = fakeStore({ withNotes: [{ sessionId: 's1', note: 'resynced note' }] })
    const search = new SearchService({ store, dbPath, searchChatContent: false, searchSessionNotes: true, isDisposed: () => false })
    search.putNoteIfEnabled('s1', 'resynced note')
    expect(await search.search('resynced')).toContain('s1')

    search.setSessionNotesEnabled(false)
    expect(await search.search('resynced')).toEqual([])

    search.setSessionNotesEnabled(true)
    expect(await search.search('resynced')).toContain('s1')
  })

  it('setChatContentEnabled()/setSessionNotesEnabled() ignore a non-boolean (missing-field-is-unchanged, CLAUDE.md)', async () => {
    const search = new SearchService({
      store: fakeStore({}), dbPath, searchChatContent: true, searchSessionNotes: true, isDisposed: () => false,
    })
    // @ts-expect-error -- exercising the runtime guard against a caller that sent undefined
    search.setChatContentEnabled(undefined)
    // Still enabled (unchanged): indexCount() must still consult the real index rather than
    // treating the flag as switched off.
    expect(search.indexCount()).toBe(0) // an empty index, but chat content search is still "on"
  })

  it('indexCount()/noteCount() are 0 while their kind of search is off, regardless of what is indexed', async () => {
    const search = new SearchService({
      store: fakeStore({}), dbPath, searchChatContent: false, searchSessionNotes: false, isDisposed: () => false,
    })
    expect(search.indexCount()).toBe(0)
    expect(search.noteCount()).toBe(0)
  })

  it('rebuild() clears the index and resyncs notes, then rebuilds content from the store', async () => {
    const jsonl = join(dir, 'session.jsonl')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(jsonl, `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'a distinctive phrase' } })}\n`)
    const store = fakeStore({
      visible: [{ sessionId: 's1', filePath: jsonl } as StoredSession],
      withNotes: [{ sessionId: 's1', note: 'a rebuilt note' }],
    })
    const search = new SearchService({ store, dbPath, searchChatContent: true, searchSessionNotes: true, isDisposed: () => false })
    await search.rebuild()
    expect(await search.search('rebuilt')).toContain('s1')
    expect(await search.search('distinctive')).toContain('s1')
  })

  it('update() does nothing once isDisposed() is true', async () => {
    let disposed = false
    const store = fakeStore({ visible: [{ sessionId: 's1', filePath: join(dir, 'missing.jsonl') } as StoredSession] })
    const search = new SearchService({
      store, dbPath, searchChatContent: true, searchSessionNotes: true, isDisposed: () => disposed,
    })
    disposed = true
    await expect(search.update()).resolves.toBeUndefined()
  })

  it('close() can be called even when nothing was ever opened', async () => {
    const search = new SearchService({ store: fakeStore({}), dbPath, isDisposed: () => false })
    await expect(search.close()).resolves.toBeUndefined()
  })
})
