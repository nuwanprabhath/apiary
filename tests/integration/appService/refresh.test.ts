import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { realpathSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppService } from '../../../src/main/appService'
import { makeSession } from '../../fixtures/makeSession'
import { createServiceFixture, teardownServiceFixture, captureRefreshPass } from './setup'

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
describe('MAIN-1: incremental, path-scoped refresh', () => {
  it('a full pass that finds no changed transcript re-parses nothing the second time', async () => {
    makeSession(projects(), '-w', {
      sessionId: '11111111-1111-1111-1111-111111111111', cwd: workdir, title: 'Unchanged',
    })
    const first = captureRefreshPass()
    await service.refresh()
    expect(first.calls()[0]?.parsed).toBe(1)
    first.restore()

    const second = captureRefreshPass()
    await service.refresh() // full again — nothing on disk changed
    expect(second.calls()[0]?.parsed).toBe(0)
    second.restore()
  })

  it('a transcript appended to is re-read on the next scoped pass, and its title updates', async () => {
    const file = makeSession(projects(), '-w', {
      sessionId: '22222222-2222-2222-2222-222222222222', cwd: workdir, title: 'Before',
    })
    await service.refresh()
    await service.importSessions(['22222222-2222-2222-2222-222222222222'], [])
    expect((await service.tree())[0].sessions[0].title).toBe('Before')

    // Simulate Claude appending an `ai-title` record, the way a real rescan would find it — with
    // a distinct mtime and size so `isUnchanged` (and, for the scoped path, "this file is what
    // changed") both see it as worth re-reading.
    makeSession(projects(), '-w', {
      sessionId: '22222222-2222-2222-2222-222222222222', cwd: workdir, title: 'After',
    })

    const pass = captureRefreshPass()
    await service.refresh({ paths: [file] })
    expect(pass.calls()[0]).toMatchObject({ full: false, files: 1, parsed: 1 })
    pass.restore()

    expect((await service.tree())[0].sessions[0].title).toBe('After')
  })

  it('a scoped pass does not re-resolve or re-read a folder that was not named', async () => {
    const workdir2 = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-work-')))
    try {
      const fileA = makeSession(projects(), '-a', {
        sessionId: '33333333-3333-3333-3333-333333333333', cwd: workdir,
      })
      makeSession(projects(), '-b', {
        sessionId: '44444444-4444-4444-4444-444444444444', cwd: workdir2,
      })
      await service.refresh() // full pass: both folders resolved once

      const pass = captureRefreshPass()
      await service.refresh({ paths: [fileA] })
      // Only workdir's cwd is resolved on this scoped pass — workdir2 is left alone.
      expect(pass.calls()[0]).toMatchObject({ full: false, folders: 1 })
      pass.restore()
    } finally {
      rmSync(workdir2, { recursive: true, force: true })
    }
  })

  it('still upserts every project and session in one commit on a full pass (MAIN-2)', async () => {
    makeSession(projects(), '-w', {
      sessionId: '55555555-4444-4444-4444-444444444444', cwd: workdir, title: 'One',
    })
    await service.refresh()
    expect(await service.discovered()).toHaveLength(1)
  })
})
