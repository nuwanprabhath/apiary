import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asSessionId } from '@shared/domain/ids'
import { buildServices } from '../fixtures/buildService'
import { makeSession } from '../fixtures/makeSession'
import type { Services } from '../../src/main/app/servicesContainer'

const SID = asSessionId('22222222-2222-4222-8222-222222222222')
const OTHER = asSessionId('33333333-3333-4333-8333-333333333333')
const topic = { title: 'Zebra', summary: 'quokka migration', keywords: ['quokka'], refs: [], startLine: 1, endLine: 2 }

let home: string
let workdir: string
let built: Services

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'apiary-erase-'))
  workdir = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-erasework-')))
  mkdirSync(join(home, '.claude', 'projects'), { recursive: true })
  built = buildServices({
    configRoot: join(home, '.claude'), dbPath: join(home, 'apiary.db'), detectLive: async () => new Map(), homeDir: home,
    accountsOutside: { exec: async () => '', platform: 'linux' },
  })
  makeSession(join(home, '.claude', 'projects'), '-w', { sessionId: SID, cwd: workdir, title: 'One', firstPrompt: 'fix the quokka export' })
  makeSession(join(home, '.claude', 'projects'), '-w', { sessionId: OTHER, cwd: workdir, title: 'Two', firstPrompt: 'another quokka thing' })
  await built.service.refresh()
  await built.service.importSessions([SID, OTHER], [])
  await built.service.updateSearchIndex({ sessionIds: null })
  for (const id of [SID, OTHER]) built.knowledge.store.record(id, [topic], { lastLine: 2, size: 1, model: 'm', at: Date.now() })
})
afterEach(async () => {
  await built.service.dispose()
  rmSync(home, { recursive: true, force: true })
  rmSync(workdir, { recursive: true, force: true })
})

describe('removing a session', () => {
  it("erases its search chunks and its digests, and leaves the others'", async () => {
    expect((await built.service.searchSessions('quokka')).sort()).toEqual([SID, OTHER].sort())
    await built.service.removeSession(SID)
    expect(await built.service.searchSessions('quokka')).toEqual([OTHER])
    expect(built.knowledge.store.topicsOf(SID)).toEqual([])
    expect(built.knowledge.store.state(SID)).toBeNull()
    expect(built.knowledge.store.topicsOf(OTHER)).toHaveLength(1)
  })

  it('is not indexed again by a later pass', async () => {
    await built.service.removeSession(SID)
    await built.service.updateSearchIndex({ sessionIds: [SID] })
    await built.service.updateSearchIndex({ sessionIds: null })
    expect(await built.service.searchSessions('quokka')).toEqual([OTHER])
  })
})
