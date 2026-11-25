import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KnowledgeStore } from '../../src/main/knowledge/knowledgeStore'

let dir: string
let store: KnowledgeStore

const topic = { title: 'Auth', summary: 'login work', keywords: ['login'], refs: [], startLine: 1, endLine: 5 }
const plant = (id: string, at: number): void => {
  store.record(id, [topic], { lastLine: 5, size: 10, model: 'm', at })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apiary-kforget-'))
  store = new KnowledgeStore(join(dir, 'knowledge.db'))
})
afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('erasing digests', () => {
  it('forgets one session and nothing else', () => {
    plant('a', 1)
    plant('b', 1)
    store.forget('a')
    expect(store.topicsOf('a')).toEqual([])
    expect(store.state('a')).toBeNull()
    expect(store.topicsOf('b')).toHaveLength(1)
  })

  it('forgets every session no longer live', () => {
    plant('a', 1)
    plant('b', 1)
    expect(store.forgetMissing(new Set(['b']))).toBe(1)
    expect(store.state('a')).toBeNull()
    expect(store.state('b')).not.toBeNull()
  })

  it('forgets digests older than a cut-off', () => {
    plant('old', 100)
    plant('new', 300)
    expect(store.forgetOlderThan(200)).toBe(1)
    expect(store.topicsOf('old')).toEqual([])
    expect(store.topicsOf('new')).toHaveLength(1)
    expect(store.search('login', 10).map((h) => h.sessionId)).toEqual(['new'])
  })
})
