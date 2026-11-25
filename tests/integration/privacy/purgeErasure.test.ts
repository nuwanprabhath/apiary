import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asSessionId } from '@shared/domain/ids'
import { buildServices } from '../../fixtures/buildService'
import { makeSession } from '../../fixtures/makeSession'
import type { Services } from '../../../src/main/app/servicesContainer'

const SIDS = [asSessionId('22222222-2222-4222-8222-222222222222'), asSessionId('33333333-3333-4333-8333-333333333333')]
const topic = { title: 'Zebra', summary: 'quokka migration', keywords: ['quokka'], refs: [], startLine: 1, endLine: 2 }

// `removeSession` erasing one session's rows from search.db and knowledge.db is
// tests/integration/removeSessionErases.test.ts; this is the purge of the digests over the real store.
// The purge's `searchIndex` target calls `SearchService.rebuild`, which clears search.db and then
// indexes every session again at once, so it is not asserted empty here (see the E3 report).
let home: string
let workdir: string
let sentinel: string
let built: Services

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'apiary-purge-int-'))
  workdir = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-purge-work-')))
  mkdirSync(join(home, '.claude', 'projects'), { recursive: true })
  sentinel = join(home, '.claude', 'sentinel.json')
  writeFileSync(sentinel, '{"keep":true}')
  built = buildServices({
    configRoot: join(home, '.claude'), dbPath: join(home, 'apiary.db'), detectLive: async () => new Map(), homeDir: home,
    accountsOutside: { exec: async () => '', platform: 'linux' },
  })
  for (const sessionId of SIDS) makeSession(join(home, '.claude', 'projects'), '-w', { sessionId, cwd: workdir, title: 'T', firstPrompt: 'fix the quokka export' })
  await built.service.refresh()
  await built.service.importSessions(SIDS, [])
  await built.service.updateSearchIndex({ sessionIds: null })
  for (const id of SIDS) built.knowledge.store.record(id, [topic], { lastLine: 2, size: 1, model: 'm', at: Date.now() })
})
afterEach(async () => {
  await built.service.dispose()
  rmSync(home, { recursive: true, force: true })
  rmSync(workdir, { recursive: true, force: true })
})

describe('purging the derived stores', () => {
  it('empties the digests, and leaves Claude\'s own files alone', async () => {
    expect(await built.service.searchSessions('quokka')).toHaveLength(2)
    expect(built.knowledge.store.topicsOf(SIDS[0] ?? asSessionId(''))).toHaveLength(1)

    await built.knowledge.digester.reset()

    for (const id of SIDS) {
      expect(built.knowledge.store.topicsOf(id)).toEqual([])
      expect(built.knowledge.store.state(id)).toBeNull()
    }
    expect(existsSync(sentinel)).toBe(true)
    expect(existsSync(join(home, '.claude', 'projects', '-w'))).toBe(true)
  })
})
