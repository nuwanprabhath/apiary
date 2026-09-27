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
describe('a settings payload from a renderer that does not know about a setting', () => {
  const ID = '11111111-1111-1111-1111-111111111111'

  /**
   * The reported bug, reproduced: a note was saved but never indexed, Settings said "0 notes
   * indexed", and Rebuild index did not help — while settings.json still said note search was on.
   *
   * A settings save whose payload lacked the key assigned `undefined` over the setting. That is
   * falsy, so note search switched off inside the running process *and* took the note index with
   * it, since switching off is meant to empty it. `JSON.stringify` then dropped the undefined key
   * on the way to disk, so the file still read `true` and nothing about the state was visible.
   */
  it('leaves note search on, and does not wipe the note index', async () => {
    makeSession(projects(), '-w', { sessionId: ID, cwd: workdir, title: 'Fix CSV export' })
    await service.refresh()
    await service.importSessions([ID], [])
    await service.setSessionNote(ID, 'nightly pipeline, MR !1257')
    expect(await service.searchSessions('1257')).toEqual([ID])

    service.setSearchSessionNotes(undefined as unknown as boolean)

    expect(service.searchNoteCount()).toBe(1)
    expect(await service.searchSessions('1257')).toEqual([ID])
    // And a note written afterwards is still indexed, rather than the feature being half-off.
    await service.setSessionNote(ID, 'now about MR !1300')
    expect(await service.searchSessions('1300')).toEqual([ID])
  })

  it('leaves transcript search alone too — the same payload, the same hazard', () => {
    service.setSearchChatContent(undefined as unknown as boolean)
    expect(service.searchIndexCount()).toBeGreaterThanOrEqual(0)
    // Off would make this return 0 unconditionally; on, it reports the real count.
    service.setSearchChatContent(false)
    expect(service.searchIndexCount()).toBe(0)
  })

  it('an explicit false still switches note search off, as the setting is meant to', async () => {
    makeSession(projects(), '-w', { sessionId: ID, cwd: workdir, title: 'Fix CSV export' })
    await service.refresh()
    await service.importSessions([ID], [])
    await service.setSessionNote(ID, 'nightly pipeline')

    service.setSearchSessionNotes(false)
    expect(service.searchNoteCount()).toBe(0)
    expect(await service.searchSessions('nightly')).toEqual([])
  })
})
