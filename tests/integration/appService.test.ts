import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  existsSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppService } from '../../src/main/appService'
import { makeSession } from '../fixtures/makeSession'

let home: string
let workdir: string
let service: AppService

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'apiary-home-'))
  workdir = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-work-')))
  mkdirSync(join(home, '.claude', 'projects'), { recursive: true })
  service = new AppService({
    configRoot: join(home, '.claude'),
    dbPath: join(home, 'apiary.db'),
    detectLive: async () => new Map(),
  })
})
afterEach(async () => {
  await service.dispose()
  rmSync(home, { recursive: true, force: true })
  rmSync(workdir, { recursive: true, force: true })
})

const projects = () => join(home, '.claude', 'projects')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
}

function makeGitWorkdir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-work-git-')))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'Test')
  writeFileSync(join(dir, 'README.md'), 'hi')
  git(dir, 'add', '.')
  git(dir, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'init')
  return dir
}

describe('AppService', () => {
  it('discovers sessions but shows an empty tree before import', async () => {
    makeSession(projects(), '-w', {
      sessionId: '11111111-1111-1111-1111-111111111111',
      cwd: workdir,
      title: 'Fix CSV export',
    })
    await service.refresh()
    expect(await service.discovered()).toHaveLength(1)
    expect(await service.tree()).toHaveLength(0)
  })

  it('shows imported sessions in the tree', async () => {
    makeSession(projects(), '-w', {
      sessionId: '11111111-1111-1111-1111-111111111111',
      cwd: workdir,
      title: 'Fix CSV export',
    })
    await service.refresh()
    await service.importSessions(['11111111-1111-1111-1111-111111111111'], [workdir])
    const tree = await service.tree()
    expect(tree).toHaveLength(1)
    expect(tree[0].sessions[0].title).toBe('Fix CSV export')
    expect(tree[0].sessions[0].cwdExists).toBe(true)
  })

  it('filters the tree by query', async () => {
    makeSession(projects(), '-w', {
      sessionId: '11111111-1111-1111-1111-111111111111', cwd: workdir, title: 'Fix CSV export',
    })
    makeSession(projects(), '-w', {
      sessionId: '22222222-2222-2222-2222-222222222222', cwd: workdir, title: 'Bump deps',
    })
    await service.refresh()
    await service.importSessions(
      ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
      [],
    )
    const tree = await service.tree('csv')
    expect(tree[0].sessions.map((s) => s.title)).toEqual(['Fix CSV export'])
  })

  it('auto-imports a new session in an auto-import project', async () => {
    makeSession(projects(), '-w', {
      sessionId: '11111111-1111-1111-1111-111111111111', cwd: workdir, title: 'First',
    })
    await service.refresh()
    await service.importSessions(['11111111-1111-1111-1111-111111111111'], [workdir])
    makeSession(projects(), '-w', {
      sessionId: '22222222-2222-2222-2222-222222222222', cwd: workdir, title: 'Second',
    })
    await service.refresh()
    const tree = await service.tree()
    expect(tree[0].sessions.map((s) => s.title).sort()).toEqual(['First', 'Second'])
  })

  it('returns a transcript page and caches the message count', async () => {
    makeSession(projects(), '-w', {
      sessionId: '11111111-1111-1111-1111-111111111111', cwd: workdir,
      title: 'Fix CSV export', firstPrompt: 'the export is empty',
    })
    await service.refresh()
    await service.importSessions(['11111111-1111-1111-1111-111111111111'], [])
    const page = await service.transcript('11111111-1111-1111-1111-111111111111')
    expect(page.messages.length).toBeGreaterThan(0)
    const tree = await service.tree()
    expect(tree[0].sessions[0].messageCount).toBeGreaterThan(0)
  })

  it('refuses to resume when the working directory is gone', async () => {
    makeSession(projects(), '-w', {
      sessionId: '11111111-1111-1111-1111-111111111111',
      cwd: '/definitely/not/here',
      title: 'Orphan',
    })
    await service.refresh()
    await service.importSessions(['11111111-1111-1111-1111-111111111111'], [])
    await expect(service.resume('11111111-1111-1111-1111-111111111111', false))
      .rejects.toThrow(/no longer exists/i)
  })

  it('rejects starting a new session in a project the store does not know about', async () => {
    await service.refresh() // no projects scanned yet
    await expect(service.newSessionInProject(workdir)).rejects.toThrow(/unknown project/i)
  })

  it('starts a new session in a known project and flips its auto-import flag', async () => {
    makeSession(projects(), '-w', {
      sessionId: '11111111-1111-1111-1111-111111111111', cwd: workdir, title: 'Existing',
    })
    await service.refresh()
    await service.importSessions(['11111111-1111-1111-1111-111111111111'], [])

    const info = await service.newSessionInProject(workdir)
    expect(info.cwd).toBe(workdir)
    expect(info.ptyId.startsWith('new:')).toBe(true)
    expect(service.pty.has(info.ptyId)).toBe(true)

    // Auto-import must now be set: a session written into this folder afterwards should show
    // up in the tree without a separate import step, exactly like an auto-imported folder does.
    makeSession(projects(), '-w', {
      sessionId: '22222222-2222-2222-2222-222222222222', cwd: workdir, title: 'Freshly started',
    })
    await service.refresh()
    const tree = await service.tree()
    expect(tree[0].sessions.map((s) => s.title).sort()).toEqual(['Existing', 'Freshly started'])
  })

  it('opens a shell alongside a still-pending new session, keyed by its pty id', async () => {
    makeSession(projects(), '-w', {
      sessionId: '33333333-3333-3333-3333-333333333333', cwd: workdir, title: 'Existing',
    })
    await service.refresh()
    await service.importSessions(['33333333-3333-3333-3333-333333333333'], [])

    const info = await service.newSessionInProject(workdir)
    await service.openShellForPty(info.ptyId, '1')
    expect(service.pty.has(`shell:${info.ptyId}:1`)).toBe(true)
  })

  it('refuses to open a shell for an unknown pty id', async () => {
    await expect(service.openShellForPty('new:does-not-exist', '1')).rejects.toThrow(/unknown session/i)
  })

  it('renames a session, and the rename survives a rescan', async () => {
    makeSession(projects(), '-w', {
      sessionId: '11111111-1111-1111-1111-111111111111', cwd: workdir, title: 'Fix CSV export',
    })
    await service.refresh()
    await service.importSessions(['11111111-1111-1111-1111-111111111111'], [])

    await service.renameSession('11111111-1111-1111-1111-111111111111', '  My renamed title  ')
    let tree = await service.tree()
    expect(tree[0].sessions[0].title).toBe('My renamed title')

    // A rescan (the watcher's normal debounced path) must not revert it.
    await service.refresh()
    tree = await service.tree()
    expect(tree[0].sessions[0].title).toBe('My renamed title')

    // An empty title clears the override, reverting to the scanned one.
    await service.renameSession('11111111-1111-1111-1111-111111111111', '   ')
    tree = await service.tree()
    expect(tree[0].sessions[0].title).toBe('Fix CSV export')
  })

  it('rejects renaming an unknown session', async () => {
    await expect(service.renameSession('does-not-exist', 'New title')).rejects.toThrow(/unknown session/i)
  })

  it('removes a session from the tree without touching its file, and re-importing brings it back', async () => {
    const file = makeSession(projects(), '-w', {
      sessionId: '11111111-1111-1111-1111-111111111111', cwd: workdir, title: 'Fix CSV export',
    })
    await service.refresh()
    await service.importSessions(['11111111-1111-1111-1111-111111111111'], [])
    expect(await service.tree()).toHaveLength(1)

    await service.removeSession('11111111-1111-1111-1111-111111111111')
    expect(await service.tree()).toHaveLength(0)
    // Never touches the JSONL — ~/.claude/projects stays strictly read-only.
    expect(existsSync(file)).toBe(true)
    // Still discoverable by the Import dialog.
    expect(await service.discovered()).toHaveLength(1)

    await service.importSessions(['11111111-1111-1111-1111-111111111111'], [])
    expect(await service.tree()).toHaveLength(1)
  })

  it('rejects removing an unknown session', async () => {
    await expect(service.removeSession('does-not-exist')).rejects.toThrow(/unknown session/i)
  })

  it('refuses to remove a session that is still live', async () => {
    const liveService = new AppService({
      configRoot: join(home, '.claude'),
      dbPath: join(home, 'apiary3.db'),
      detectLive: async () => new Map([['11111111-1111-1111-1111-111111111111', 4242]]),
    })
    try {
      makeSession(projects(), '-w', {
        sessionId: '11111111-1111-1111-1111-111111111111', cwd: workdir, title: 'Live one',
      })
      await liveService.refresh()
      await liveService.importSessions(['11111111-1111-1111-1111-111111111111'], [])
      await expect(liveService.removeSession('11111111-1111-1111-1111-111111111111'))
        .rejects.toThrow(/still running/i)
      expect(await liveService.tree()).toHaveLength(1)
    } finally {
      await liveService.dispose()
    }
  })

  it('starts a new session in a folder Apiary has never scanned, creating its project row', async () => {
    const info = await service.newSessionInFolder(workdir)
    expect(info.cwd).toBe(workdir)
    expect(service.pty.has(info.ptyId)).toBe(true)

    // A first-ever session Claude writes into this brand-new folder must end up visible without
    // any explicit import step.
    makeSession(projects(), '-fresh', {
      sessionId: '33333333-3333-3333-3333-333333333333', cwd: workdir, title: 'First session here',
    })
    await service.refresh()
    const tree = await service.tree()
    expect(tree).toHaveLength(1)
    expect(tree[0].sessions[0].title).toBe('First session here')
  })

  it('refuses to start a new session in a folder that does not exist', async () => {
    await expect(service.newSessionInFolder('/definitely/not/here')).rejects.toThrow(/does not exist/i)
  })

  it('reports a conflict when the session is already live', async () => {
    const liveService = new AppService({
      configRoot: join(home, '.claude'),
      dbPath: join(home, 'apiary2.db'),
      detectLive: async () => new Map([['11111111-1111-1111-1111-111111111111', 4242]]),
    })
    try {
      makeSession(projects(), '-w', {
        sessionId: '11111111-1111-1111-1111-111111111111', cwd: workdir, title: 'Live one',
      })
      await liveService.refresh()
      await liveService.importSessions(['11111111-1111-1111-1111-111111111111'], [])
      const conflict = await liveService.checkConflict('11111111-1111-1111-1111-111111111111')
      expect(conflict).toEqual({ sessionId: '11111111-1111-1111-1111-111111111111', pid: 4242 })
      const tree = await liveService.tree()
      expect(tree[0].sessions[0].isLive).toBe(true)
    } finally {
      await liveService.dispose()
    }
  })

  it('groups sessions recorded under a symlinked cwd into one project (carried decision 1)', async () => {
    const real = mkdtempSync(join(tmpdir(), 'apiary-real-'))
    const linkParent = mkdtempSync(join(tmpdir(), 'apiary-link-'))
    const link = join(linkParent, 'alias')
    symlinkSync(real, link)
    try {
      const canonical = realpathSync(real)
      makeSession(projects(), '-w1', {
        sessionId: '33333333-3333-3333-3333-333333333333',
        cwd: canonical,
        title: 'Via canonical path',
      })
      makeSession(projects(), '-w2', {
        sessionId: '44444444-4444-4444-4444-444444444444',
        cwd: link,
        title: 'Via symlinked alias',
      })
      await service.refresh()
      await service.importSessions(
        ['33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444'],
        [],
      )
      const tree = await service.tree()
      expect(tree).toHaveLength(1)
      expect(tree[0].sessions.map((s) => s.title).sort()).toEqual([
        'Via canonical path',
        'Via symlinked alias',
      ])
    } finally {
      rmSync(linkParent, { recursive: true, force: true })
      rmSync(real, { recursive: true, force: true })
    }
  })

  it('does not run overlapping refreshes when refresh() is called concurrently', async () => {
    let calls = 0
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const guardedService = new AppService({
      configRoot: join(home, '.claude'),
      dbPath: join(home, 'apiary-guard.db'),
      detectLive: async () => {
        calls++
        await gate
        return new Map()
      },
    })
    try {
      makeSession(projects(), '-w', {
        sessionId: '55555555-5555-5555-5555-555555555555',
        cwd: workdir,
        title: 'Reentrant',
      })
      const first = guardedService.refresh()
      const second = guardedService.refresh()
      // While the first run is still gated inside detectLive, a second
      // concurrent call must not have started a second run.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(calls).toBe(1)
      release()
      await Promise.all([first, second])
    } finally {
      await guardedService.dispose()
    }
  })

  it('a refresh() that joins an in-flight run still observes a file written after that run started (Finding 3)', async () => {
    let calls = 0
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const rerunService = new AppService({
      configRoot: join(home, '.claude'),
      dbPath: join(home, 'apiary-rerun.db'),
      // detectLive runs at the very end of a scan pass, after scanProjects() has already read
      // whatever session files existed on disk at that point — so gating here, then writing a
      // new session file, reliably simulates "a write landed mid-run, after this run's own
      // snapshot was already taken".
      detectLive: async () => {
        calls++
        await gate
        return new Map()
      },
    })
    try {
      makeSession(projects(), '-w', {
        sessionId: '77777777-7777-7777-7777-777777777777',
        cwd: workdir,
        title: 'First session',
      })
      const first = rerunService.refresh()
      // Let the first run reach and block on the detectLive gate — its scanProjects() snapshot
      // is now taken and does not include the session written below.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(calls).toBe(1)

      makeSession(projects(), '-w2', {
        sessionId: '88888888-8888-8888-8888-888888888888',
        cwd: workdir,
        title: 'Written mid-run',
      })

      // This call joins the in-flight run rather than starting a second one immediately, but it
      // must still result in a pass that sees the file written above.
      const second = rerunService.refresh()

      release()
      await Promise.all([first, second])

      // Without the pending-rerun fix, only the first (stale) scan ever runs and this session
      // is invisible until an unrelated later refresh happens to fire.
      const discovered = await rerunService.discovered()
      expect(discovered.map((s) => s.sessionId).sort()).toEqual([
        '77777777-7777-7777-7777-777777777777',
        '88888888-8888-8888-8888-888888888888',
      ])
      // A second pass actually ran (not just a resolved promise): detectLive was called twice.
      expect(calls).toBe(2)
    } finally {
      await rerunService.dispose()
    }
  })

  it('recovers after a refresh rejects so later refreshes still run', async () => {
    let calls = 0
    let shouldFail = true
    const recoveringService = new AppService({
      configRoot: join(home, '.claude'),
      dbPath: join(home, 'apiary-recover.db'),
      detectLive: async () => {
        calls++
        if (shouldFail) throw new Error('boom')
        return new Map()
      },
    })
    try {
      makeSession(projects(), '-w', {
        sessionId: '66666666-6666-6666-6666-666666666666',
        cwd: workdir,
        title: 'Recovers',
      })
      await expect(recoveringService.refresh()).rejects.toThrow('boom')
      shouldFail = false
      await recoveringService.refresh()
      expect(calls).toBe(2)
    } finally {
      await recoveringService.dispose()
    }
  })
})

describe('git operations', () => {
  it('resolves a session id to its cwd for gitStatus, and rejects an unknown session', async () => {
    const gitDir = makeGitWorkdir()
    makeSession(projects(), '-gitw', {
      sessionId: '66666666-6666-6666-6666-666666666666', cwd: gitDir, title: 'Git session',
    })
    await service.refresh()
    await service.importSessions(['66666666-6666-6666-6666-666666666666'], [])

    const s = await service.gitStatus('66666666-6666-6666-6666-666666666666', false)
    expect(s.branch).toBe('main')

    await expect(service.gitStatus('does-not-exist', false)).rejects.toThrow(/unknown session/i)
    rmSync(gitDir, { recursive: true, force: true })
  })

  it('resolves a pty id to its cwd for gitStatus (the new-session path)', async () => {
    const gitDir = makeGitWorkdir()
    const info = await service.newSessionInFolder(gitDir)
    const s = await service.gitStatus(info.ptyId, true)
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
    expect(s.branch).toBe('feature/y')
    rmSync(gitDir, { recursive: true, force: true })
  })

  it('reflects the new branch in tree() after a checkout, once refresh() is called (the pattern the gitCheckoutBranch IPC handler uses)', async () => {
    const gitDir = makeGitWorkdir()
    const sessionId = '88888888-8888-8888-8888-888888888888'
    makeSession(projects(), '-gitw3', { sessionId, cwd: gitDir, title: 'Git session 3' })
    await service.refresh()
    await service.importSessions([sessionId], [])

    const before = await service.tree('')
    expect(before[0]?.branch).toBe('main')

    git(gitDir, 'branch', 'feature/z')
    await service.gitCheckoutBranch(sessionId, false, 'feature/z')
    // Mirrors what the ipc.ts handler now does: refresh() after the checkout, before the caller
    // re-fetches the tree — without it, tree() keeps reporting the pre-checkout branch because
    // the `branch` column is only ever written by refresh() (via resolveProject), not by
    // gitCheckoutBranch itself.
    await service.refresh()

    const after = await service.tree('')
    expect(after[0]?.branch).toBe('feature/z')
    rmSync(gitDir, { recursive: true, force: true })
  })
})

describe('multi-tab shells', () => {
  it('spawns distinct ptys for two tabs of the same session', async () => {
    makeSession(projects(), '-w', {
      sessionId: '11111111-1111-1111-1111-111111111111', cwd: workdir, title: 'Fix CSV export',
    })
    await service.refresh()
    await service.importSessions(['11111111-1111-1111-1111-111111111111'], [])

    await service.openShell('11111111-1111-1111-1111-111111111111', '1')
    await service.openShell('11111111-1111-1111-1111-111111111111', '2')
    expect(service.pty.has('shell:11111111-1111-1111-1111-111111111111:1')).toBe(true)
    expect(service.pty.has('shell:11111111-1111-1111-1111-111111111111:2')).toBe(true)
  })
})
