import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asSessionId } from '@shared/domain/ids'
import { KnowledgeService } from '../../../src/main/knowledge/knowledgeService'
import { KnowledgeStore } from '../../../src/main/knowledge/knowledgeStore'
import { SearchClient } from '../../../src/main/search/searchClient'
import { SearchIndex } from '../../../src/main/search/searchIndex'
import { SearchService } from '../../../src/main/search/searchService'
import type { SessionStore, StoredSession } from '../../../src/main/store/sessionStore'

const line = (role: 'user' | 'assistant', text: string): string =>
  JSON.stringify({ type: role, message: { role, content: [{ type: 'text', text }] } })

describe('KnowledgeService', () => {
  let dir: string
  let knowledge: KnowledgeStore
  let service: KnowledgeService
  let search: SearchService
  const sessions = new Map<string, StoredSession>()

  const add = (id: string, lastActive: number, lines: string[], title = id): void => {
    const filePath = join(dir, `${id}.jsonl`)
    writeFileSync(filePath, `${lines.join('\n')}\n`)
    sessions.set(id, {
      sessionId: asSessionId(id), filePath, title, cwd: '/work/proj', projectPath: '/work/proj', gitBranch: 'main',
      lastActiveAtMs: lastActive, fileMtimeMs: lastActive, firstPrompt: null,
    } as StoredSession)
  }
  const topic = (title: string, startLine: number, endLine: number, extra: { summary?: string; refs?: string[] } = {}) => ({
    title, summary: extra.summary ?? '', keywords: [], refs: extra.refs ?? [], startLine, endLine,
  })

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'apiary-knowledge-'))
    sessions.clear()
    knowledge = new KnowledgeStore(join(dir, 'knowledge.db'))
    const store = {
      getSession: (id: string) => sessions.get(id) ?? null,
      visibleSessions: () => [...sessions.values()],
      sessionsWithNotes: () => [],
    } as unknown as SessionStore
    const dbPath = join(dir, 'search.db')
    search = new SearchService({
      store, createIndex: () => new SearchIndex(dbPath), createClient: () => new SearchClient(dbPath), isDisposed: () => false,
    })
    service = new KnowledgeService({ store, search, knowledge })
    add('byref', 10, [line('user', 'Can you review !1175 in grp/proj?')])
    add('bytopic', 20, [line('user', 'lets talk'), line('assistant', 'sure'), line('user', 'about the interface')])
    add('bytext', 30, [line('user', 'we should redesign the interface layer')])
    add('bytitle', 40, [line('user', 'unrelated')], 'Interface notes')
    knowledge.record('bytopic', [topic('Designing the API interface', 1, 3, { summary: 'REST design' })], {
      lastLine: 3, size: 1, model: 'haiku', at: 1,
    })
    await search.update()
  })
  afterEach(async () => {
    await search.close()
    knowledge.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('a ref outranks a topic, which outranks text', async () => {
    // "interface" is in a topic, in text and in a title; "1175" is only a ref.
    add('byref', 10, [line('user', 'Can you review !1175 in grp/proj? The interface is odd.')])
    await search.update()
    const refHits = await service.find('!1175 interface', 10)
    expect(refHits[0]).toMatchObject({ sessionId: 'byref', reason: 'ref' })

    const hits = await service.find('interface', 10)
    expect(hits.map((h) => `${h.sessionId}:${h.reason}`)).toEqual([
      'bytopic:topic', 'bytext:text', 'byref:text', 'bytitle:title',
    ])
  })

  it('a pasted GitLab URL finds the !n session', async () => {
    const hits = await service.find('https://gitlab.example.com/grp/proj/-/merge_requests/1175', 5)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ sessionId: 'byref', reason: 'ref', folder: '/work/proj', branch: 'main', lastActive: 10 })
  })

  it('find returns topic and snippet for a topic hit', async () => {
    const [hit] = await service.find('REST design', 5)
    expect(hit).toMatchObject({ sessionId: 'bytopic', reason: 'topic', topic: 'Designing the API interface' })
    expect(hit.snippet).toContain('«')
  })

  it('read returns a topic\'s lines, capped', async () => {
    const [t] = await service.topics(asSessionId('bytopic'))
    const full = await service.read(asSessionId('bytopic'), { topicId: t.id, maxChars: 10_000 })
    expect(full).toBe('1: User: lets talk\n2: Claude: sure\n3: User: about the interface')
    const capped = await service.read(asSessionId('bytopic'), { topicId: t.id, maxChars: 30 })
    expect(capped?.length).toBeLessThanOrEqual(30)
    expect(capped?.startsWith('1: User: lets talk')).toBe(true)
  })

  it('read finds the lines around a query, else the tail', async () => {
    expect(await service.read(asSessionId('bytopic'), { query: 'sure', maxChars: 1000 })).toContain('2: Claude: sure')
    const tail = await service.read(asSessionId('bytopic'), { maxChars: 40 })
    expect(tail?.length).toBeLessThanOrEqual(40)
    expect(tail).toContain('3: User:')
    expect(tail).not.toContain('1: User')
  })

  it('read returns null for an unknown id', async () => {
    expect(await service.read(asSessionId('nope'), { maxChars: 100 })).toBeNull()
  })
})
