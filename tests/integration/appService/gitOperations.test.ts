import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { realpathSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppService } from '../../../src/main/appService'
import { makeSession } from '../../fixtures/makeSession'
import { log } from '../../../src/main/log/logger'
import { createServiceFixture, teardownServiceFixture, git, makeGitWorkdir } from './setup'

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
describe('git operations', () => {
  it('resolves a session id to its cwd for gitStatus, and rejects an unknown session', async () => {
    const gitDir = makeGitWorkdir()
    makeSession(projects(), '-gitw', {
      sessionId: '66666666-6666-6666-6666-666666666666', cwd: gitDir, title: 'Git session',
    })
    await service.refresh()
    await service.importSessions(['66666666-6666-6666-6666-666666666666'], [])

    const s = await service.gitStatus('66666666-6666-6666-6666-666666666666', false)
    if (s === null) throw new Error('expected a git status')
    expect(s.branch).toBe('main')

    await expect(service.gitStatus('does-not-exist', false)).rejects.toThrow(/unknown session/i)
    rmSync(gitDir, { recursive: true, force: true })
  })

  it('resolves gitStatus to null for a session whose folder is not a git repository (MAIN-9)', async () => {
    const plainDir = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-work-plain-')))
    makeSession(projects(), '-plain', {
      sessionId: '99999999-9999-9999-9999-999999999999', cwd: plainDir, title: 'Not a repo',
    })
    await service.refresh()
    await service.importSessions(['99999999-9999-9999-9999-999999999999'], [])

    await expect(service.gitStatus('99999999-9999-9999-9999-999999999999', false)).resolves.toBeNull()
    rmSync(plainDir, { recursive: true, force: true })
  })

  it('resolves a pty id to its cwd for gitStatus (the new-session path)', async () => {
    const gitDir = makeGitWorkdir()
    const info = await service.newSessionInFolder(gitDir)
    const s = await service.gitStatus(info.ptyId, true)
    if (s === null) throw new Error('expected a git status')
    expect(s.branch).toBe('main')
    rmSync(gitDir, { recursive: true, force: true })
  })

  it('creates and checks out a branch by session id', async () => {
    const gitDir = makeGitWorkdir()
    makeSession(projects(), '-gitw2', {
      sessionId: '77777777-7777-7777-7777-777777777777', cwd: gitDir, title: 'Git session 2',
    })
    await service.refresh()
    await service.importSessions(['77777777-7777-7777-7777-777777777777'], [])

    await service.gitCreateBranch('77777777-7777-7777-7777-777777777777', false, 'feature/y')
    const s = await service.gitStatus('77777777-7777-7777-7777-777777777777', false)
    if (s === null) throw new Error('expected a git status')
    expect(s.branch).toBe('feature/y')
    rmSync(gitDir, { recursive: true, force: true })
  })

  it('reflects the new branch in tree() after a checkout, once refreshProjectByKey is called (MAIN-4: the pattern the gitCheckoutBranch IPC handler now uses, instead of a full refresh())', async () => {
    const gitDir = makeGitWorkdir()
    const sessionId = '88888888-8888-8888-8888-888888888888'
    makeSession(projects(), '-gitw3', { sessionId, cwd: gitDir, title: 'Git session 3' })
    await service.refresh()
    await service.importSessions([sessionId], [])

    const before = await service.tree()
    expect(before[0]?.branch).toBe('main')

    git(gitDir, 'branch', 'feature/z')
    await service.gitCheckoutBranch(sessionId, false, 'feature/z')
    // MAIN-4: checking out a branch updates the project's branch through a single, targeted
    // re-resolve of this one folder — not a full-library rescan of every transcript. The `branch`
    // column is only ever written by `resolveProject`, so this is what the ipc.ts handler now
    // calls in place of `await service.refresh()`.
    await service.refreshProjectByKey(sessionId, false)

    const after = await service.tree()
    expect(after[0]?.branch).toBe('feature/z')
    rmSync(gitDir, { recursive: true, force: true })
  })

  it('refreshProjectByKey does not re-read any transcript (MAIN-4)', async () => {
    const gitDir = makeGitWorkdir()
    const sessionId = '99999999-9999-9999-9999-999999999999'
    makeSession(projects(), '-gitw4', { sessionId, cwd: gitDir, title: 'Git session 4' })
    await service.refresh()
    await service.importSessions([sessionId], [])

    const logSpy = vi.spyOn(log, 'info')
    git(gitDir, 'branch', 'feature/w')
    await service.gitCheckoutBranch(sessionId, false, 'feature/w')
    await service.refreshProjectByKey(sessionId, false)
    // Nothing under 'refresh'/'pass' is logged, because refreshProjectByKey never calls
    // runRefresh at all — it only resolves and syncs the one folder.
    expect(logSpy.mock.calls.some(([scope]) => scope === 'refresh')).toBe(false)
    logSpy.mockRestore()

    expect((await service.tree())[0]?.branch).toBe('feature/w')
    rmSync(gitDir, { recursive: true, force: true })
  })
})
