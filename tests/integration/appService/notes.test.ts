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
describe('session notes', () => {
  const ID = '11111111-1111-1111-1111-111111111111'

  /** A single imported session to hang notes off. */
  async function seed(): Promise<void> {
    makeSession(projects(), '-w', { sessionId: ID, cwd: workdir, title: 'Fix CSV export' })
    await service.refresh()
    await service.importSessions([ID], [])
  }

  it('saves a note, and shows it on the session in the tree', async () => {
    await seed()
    await service.setSessionNote(ID, '  Debugging the nightly pipeline, MR !1257  ')

    const tree = await service.tree()
    expect(tree[0].sessions[0].note).toBe('Debugging the nightly pipeline, MR !1257')
    expect(service.sessionNote(ID)).toBe('Debugging the nightly pipeline, MR !1257')
  })

  it('keeps the note across a rescan, like a rename', async () => {
    await seed()
    await service.setSessionNote(ID, 'chasing a flaky spec')
    await service.refresh()
    expect((await service.tree())[0].sessions[0].note).toBe('chasing a flaky spec')
  })

  it('an empty note removes it rather than storing a blank', async () => {
    await seed()
    await service.setSessionNote(ID, 'temporary')
    await service.setSessionNote(ID, '   ')
    expect((await service.tree())[0].sessions[0].note).toBeNull()
  })

  it('finds the session by searching what the note says', async () => {
    await seed()
    await service.setSessionNote(ID, 'nightly pipeline, MR !1257 against dev/1.0.12')

    // The identifier forms people actually type, and a plain word from the note. Note matching
    // is `searchSessions`'s job now — `tree()` no longer filters by query at all.
    for (const query of ['nightly', '!1257', '1257', 'dev/1.0.12']) {
      expect(await service.searchSessions(query)).toEqual([ID])
    }
  })

  it('searching a note is immediate — it does not wait for the next index pass', async () => {
    await seed()
    await service.setSessionNote(ID, 'carburettor')
    expect(await service.searchSessions('carburettor')).toEqual([ID])
  })

  it('stops matching once the note is changed, so an old note cannot haunt the results', async () => {
    await seed()
    await service.setSessionNote(ID, 'carburettor')
    await service.setSessionNote(ID, 'gearbox')

    expect(await service.searchSessions('carburettor')).toEqual([])
    expect(await service.searchSessions('gearbox')).toEqual([ID])
  })

  it('rejects a note on an unknown session', async () => {
    await expect(service.setSessionNote('does-not-exist', 'hi')).rejects.toThrow(/unknown session/i)
  })

  it('notes stay searchable when transcript indexing is off — they are separate settings', async () => {
    await seed()
    service.setSearchChatContent(false)
    await service.setSessionNote(ID, 'nightly pipeline')
    expect(await service.searchSessions('nightly')).toEqual([ID])
  })

  it('turning note search off stops matching, and turning it back on restores it', async () => {
    await seed()
    await service.setSessionNote(ID, 'nightly pipeline')

    service.setSearchSessionNotes(false)
    expect(await service.searchSessions('nightly')).toEqual([])
    // The note itself is untouched — it is the user's writing, not derived data.
    expect(service.sessionNote(ID)).toBe('nightly pipeline')

    service.setSearchSessionNotes(true)
    expect(await service.searchSessions('nightly')).toEqual([ID])
  })

  it('picks up notes written while note indexing was switched off', async () => {
    await seed()
    service.setSearchSessionNotes(false)
    await service.setSessionNote(ID, 'written while off')

    service.setSearchSessionNotes(true)
    expect(await service.searchSessions('written')).toEqual([ID])
  })

  it('a rebuild restores the note index from the notes themselves', async () => {
    await seed()
    await service.setSessionNote(ID, 'nightly pipeline')
    await service.rebuildSearchIndex()
    expect(await service.searchSessions('nightly')).toEqual([ID])
  })
})
