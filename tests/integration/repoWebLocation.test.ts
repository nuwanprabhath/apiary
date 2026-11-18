import { describe, expect, it } from 'vitest'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { terminalRef } from '@shared/domain/ids'
import { git, initRepo } from '../fixtures/gitRepo'
import { GitService } from '../../src/main/git/gitService'
import type { BranchOps } from '../../src/main/git/branchOps'
import { MrStatusCache } from '../../src/main/git/mrStatusCache'
import { defaultExec, type RemoteExec } from '../../src/main/plugins/remote'
import type { SessionResolver } from '../../src/main/sessions/sessionResolver'

function serviceIn(cwd: string, exec: RemoteExec): GitService {
  return new GitService({
    resolver: { resolveShellCwd: () => cwd } as Partial<SessionResolver> as SessionResolver,
    branchOps: {} as BranchOps,
    mrStatus: new MrStatusCache({ exec: async () => { throw new Error('no glab in this test') } }),
    refreshProject: async () => {},
    startSessionIn: async () => { throw new Error('not used in this test') },
    remoteExec: exec,
  })
}

const SESSION = terminalRef('session-1', false)

describe('repoWebLocation on a real repository', () => {
  it('reads origin as a GitLab page, answers from its cache, and reads again when the remote changes', async () => {
    const repo = initRepo(realpathSync(mkdtempSync(join(tmpdir(), 'apiary-weblocation-'))))
    git(repo, 'remote', 'add', 'origin', 'git@gitlab.com:group/project.git')
    let calls = 0
    const svc = serviceIn(repo, async (file, args, cwd) => { calls++; return defaultExec(file, args, cwd) })

    expect(await svc.repoWebLocation(SESSION)).toEqual({ forge: 'gitlab', webUrl: 'https://gitlab.com/group/project' })
    const first = calls
    expect(await svc.repoWebLocation(SESSION)).toEqual({ forge: 'gitlab', webUrl: 'https://gitlab.com/group/project' })
    expect(calls).toBe(first)

    git(repo, 'remote', 'set-url', 'origin', 'https://github.com/owner/repo.git')
    await expect.poll(() => svc.repoWebLocation(SESSION)).toEqual({ forge: 'github', webUrl: 'https://github.com/owner/repo' })
  })

  it('is null for a repository with no remote, and outside one', async () => {
    const repo = initRepo(realpathSync(mkdtempSync(join(tmpdir(), 'apiary-weblocation-'))))
    expect(await serviceIn(repo, defaultExec).repoWebLocation(SESSION)).toBeNull()
    const plain = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-weblocation-plain-')))
    expect(await serviceIn(plain, defaultExec).repoWebLocation(SESSION)).toBeNull()
  })
})
