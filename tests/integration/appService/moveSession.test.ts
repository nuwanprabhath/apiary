import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildAppService } from '../../fixtures/buildService'
import type { AppService } from '../../../src/main/appService'
import { makeSession } from '../../fixtures/makeSession'
import { encodeProjectDirName as encodeProjectDirNameForTest } from '../../../src/main/scanner/projectDirName'
import { createServiceFixture, teardownServiceFixture, makeGitWorkdir } from './setup'

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
describe('moveSession', () => {
  it('moves the transcript file and the session follows it, surviving a rescan', async () => {
    const target = makeGitWorkdir()
    makeSession(projects(), '-w', {
      sessionId: '33333333-3333-3333-3333-333333333333', cwd: workdir, title: 'Move me',
    })
    await service.refresh()
    await service.importSessions(['33333333-3333-3333-3333-333333333333'], [])
    // The target has to already be a project the store knows about — discovered by scanning,
    // same as any other folder — before it can be a move's destination.
    await service.newSessionInFolder(target).catch(() => {}) // registers the project row
    await service.refresh()

    await service.moveSession('33333333-3333-3333-3333-333333333333', target)
    let tree = await service.tree()
    let moved = tree.flatMap((p) => p.sessions).find((s) => s.sessionId === '33333333-3333-3333-3333-333333333333')
    expect(moved?.cwd).toBe(target)

    // A rescan reads the *old* cwd back out of the (unmoved-in-content) JSONL — the override
    // is what stops that reverting the move.
    await service.refresh()
    tree = await service.tree()
    moved = tree.flatMap((p) => p.sessions).find((s) => s.sessionId === '33333333-3333-3333-3333-333333333333')
    expect(moved?.cwd).toBe(target)
  })

  it('refuses when a session of that id already exists at the target', async () => {
    const target = makeGitWorkdir()
    makeSession(projects(), '-w', {
      sessionId: '44444444-4444-4444-4444-444444444444', cwd: workdir, title: 'Original',
    })
    await service.refresh()
    await service.importSessions(['44444444-4444-4444-4444-444444444444'], [])
    await service.newSessionInFolder(target).catch(() => {})
    await service.refresh()
    // A file already sitting where the move would land.
    mkdirSync(join(projects(), encodeProjectDirNameForTest(target)), { recursive: true })
    writeFileSync(join(projects(), encodeProjectDirNameForTest(target), '44444444-4444-4444-4444-444444444444.jsonl'), '')

    await expect(service.moveSession('44444444-4444-4444-4444-444444444444', target))
      .rejects.toThrow('already exists')
  })

  it('refuses to move a live session', async () => {
    const target = makeGitWorkdir()
    const liveService = buildAppService({
      configRoot: join(home, '.claude'), dbPath: join(home, 'apiary-live.db'),
      detectLive: async () => new Map([['55555555-5555-5555-5555-555555555555', 1234]]),
    })
    makeSession(projects(), '-w', {
      sessionId: '55555555-5555-5555-5555-555555555555', cwd: workdir, title: 'Live one',
    })
    await liveService.refresh()
    await liveService.importSessions(['55555555-5555-5555-5555-555555555555'], [])
    await liveService.newSessionInFolder(target).catch(() => {})
    await liveService.refresh()
    await expect(liveService.moveSession('55555555-5555-5555-5555-555555555555', target))
      .rejects.toThrow('still running')
    await liveService.dispose()
  })

  it('refuses to move a session whose pty is running even though the live scan has not seen it yet', async () => {
    // Exactly the sequence a user takes: click Resume, then drag the session onto another
    // worktree before the next rescan. `detectLive` is the external process scan, and it only
    // repopulates on `refresh()` — so it reports nothing here, as it would in that gap.
    const target = makeGitWorkdir()
    makeSession(projects(), '-w', {
      sessionId: '88888888-8888-8888-8888-888888888888', cwd: workdir, title: 'Resumed a moment ago',
    })
    await service.refresh()
    await service.importSessions(['88888888-8888-8888-8888-888888888888'], [])
    await service.newSessionInFolder(target).catch(() => {})
    await service.refresh()

    service.pty.spawn({
      id: '88888888-8888-8888-8888-888888888888',
      cwd: workdir,
      command: 'sleep 30',
    })
    expect(service.pty.has('88888888-8888-8888-8888-888888888888')).toBe(true)

    await expect(service.moveSession('88888888-8888-8888-8888-888888888888', target))
      .rejects.toThrow('still running')
    // And the transcript is still where it was, not half-moved.
    expect(existsSync(join(projects(), '-w', '88888888-8888-8888-8888-888888888888.jsonl'))).toBe(true)

    service.pty.kill('88888888-8888-8888-8888-888888888888')
  })
})
