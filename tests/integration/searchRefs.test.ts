import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SearchIndex } from '../../src/main/search/searchIndex'
import { SearchClient } from '../../src/main/search/searchClient'
import { SearchService } from '../../src/main/search/searchService'
import type { SessionStore, StoredSession } from '../../src/main/store/sessionStore'

const line = (role: string, content: string): string =>
  JSON.stringify({ type: role, message: { role, content } })

describe('search finds pasted links by the refs a session mentioned', () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apiary-searchrefs-'))
    dbPath = join(dir, 'search.db')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function serviceOver(sessions: Record<string, string[]>): SearchService {
    const visible = Object.entries(sessions).map(([id, lines]) => {
      const file = join(dir, `${id}.jsonl`)
      writeFileSync(file, `${lines.join('\n')}\n`)
      return { sessionId: id, filePath: file } as StoredSession
    })
    const store = { visibleSessions: () => visible, sessionsWithNotes: () => [] } as unknown as SessionStore
    return new SearchService({
      store, createIndex: () => new SearchIndex(dbPath), createClient: () => new SearchClient(dbPath),
      isDisposed: () => false,
    })
  }

  it('a pasted MR URL finds the session that mentioned !1175', async () => {
    const search = serviceOver({
      s1: [line('user', 'please review !1175 before lunch')],
      s2: [line('user', 'unrelated chat about colours')],
    })
    await search.update()
    expect(await search.search('https://gitlab.example.com/grp/proj/-/merge_requests/1175')).toEqual(['s1'])
  })

  it('a rebuild rewrites the refs with the chunks', async () => {
    const search = serviceOver({ s1: [line('user', 'see ABC-42')] })
    await search.update()
    await search.rebuild()
    expect(await search.search('https://jira.example.com/browse/ABC-42')).toEqual(['s1'])
  })
})
