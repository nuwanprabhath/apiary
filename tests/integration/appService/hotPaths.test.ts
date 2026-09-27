import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import type { AppService } from '../../../src/main/appService'
import { makeSession } from '../../fixtures/makeSession'
import { createServiceFixture, teardownServiceFixture } from './setup'

let home: string
let workdir: string
let service: AppService

beforeEach(() => {
  ;({ home, workdir, service } = createServiceFixture())
})
afterEach(async () => {
  await teardownServiceFixture({ home, workdir, service })
})

const projects = (): string => join(home, '.claude', 'projects')
describe('MAIN-10: fewer synchronous stats and lookups on hot IPC paths', () => {
  it('tree() still reports cwdExists correctly for several sessions sharing one folder', async () => {
    // The call-count reduction itself (buildTree asks cwdExists once per session; tree() now
    // memoises it per distinct path) is unit-tested in tests/unit/memoize.test.ts, since
    // `existsSync` — a Node builtin's named export — cannot be spied on under Vitest's ESM
    // module handling. This proves the memoised version is still correct: every session in a
    // shared folder still resolves the same, right answer.
    makeSession(projects(), '-w', {
      sessionId: '11111111-1111-1111-1111-111111111111', cwd: workdir, title: 'A',
    })
    makeSession(projects(), '-w', {
      sessionId: '22222222-2222-2222-2222-222222222222', cwd: workdir, title: 'B',
    })
    await service.refresh()
    await service.importSessions(
      ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'], [],
    )
    const tree = await service.tree()
    expect(tree[0].sessions).toHaveLength(2)
    expect(tree[0].sessions.every((s) => s.cwdExists)).toBe(true)
  })

  it('sessionNote looks a session up directly instead of scanning every row', async () => {
    makeSession(projects(), '-w', {
      sessionId: '11111111-1111-1111-1111-111111111111', cwd: workdir, title: 'A',
    })
    await service.refresh()
    await service.setSessionNote('11111111-1111-1111-1111-111111111111', 'a note')
    expect(service.sessionNote('11111111-1111-1111-1111-111111111111')).toBe('a note')
    expect(service.sessionNote('does-not-exist')).toBe('')
  })
})
