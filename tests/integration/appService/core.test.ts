import { asSessionId, asPtyId } from '@shared/domain/ids'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, realpathSync, symlinkSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildAppService } from '../../fixtures/buildService'
import type { AppService } from '../../../src/main/appService'
import { makeSession } from '../../fixtures/makeSession'
import { stays } from '../../fixtures/stays'
import { encodeProjectDirName as encodeProjectDirNameForTest } from '../../../src/main/scanner/projectDirName'
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

  it('tree() returns everything unfiltered; title matching is now the renderer’s job', async () => {
    makeSession(projects(), '-w', {
      sessionId: '11111111-1111-1111-1111-111111111111', cwd: workdir, title: 'Fix CSV export',
    })
    makeSession(projects(), '-w', {
      sessionId: '22222222-2222-2222-2222-222222222222', cwd: workdir, title: 'Bump deps',
    })
    await service.refresh()
    await service.importSessions(
      ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'], [],
    )
    const tree = await service.tree()
    expect(tree[0].sessions.map((s) => s.title).sort()).toEqual(['Bump deps', 'Fix CSV export'])
  })

  it('refuses to auto-import a path that is not a known project (SEC-8)', async () => {
    // importSessions's `autoImportProjects` reaches `resolveProject`, which runs `git` with `cwd`
    // set to whatever it is given — the renderer's own caller only ever echoes back a
    // `projectPath` this process handed it, but the IPC boundary does not know that, and CLAUDE.md
    // says the renderer never supplies a filesystem path main acts on without validation.
    makeSession(projects(), '-w', {
      sessionId: '11111111-1111-1111-1111-111111111111', cwd: workdir, title: 'Fix CSV export',
    })
    await service.refresh()
    await expect(service.importSessions([], ['/tmp/unknown-project-path'])).rejects.toThrow(/unknown project/i)
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
    await expect(service.resume(asSessionId('11111111-1111-1111-1111-111111111111')))
      .rejects.toThrow(/no longer exists/i)
  })

  it('rejects starting a new session in a project the store does not know about', async () => {
    await service.refresh() // no projects scanned yet
    await expect(service.newSessionInProject(workdir)).rejects.toThrow(/unknown project/i)
  })

  it('refuses to pull into a folder the sidebar does not show, before git runs anywhere', async () => {
    // The folder card's pull button sends a path from the renderer. Like every path-carrying call,
    // it is only acted on if it names a project the store already holds.
    await service.refresh()
    await expect(service.gitPullFolder(workdir)).rejects.toThrow(/unknown project/i)
    await expect(service.gitPullFolder('/etc')).rejects.toThrow(/unknown project/i)
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

  describe('every worktree of a folder, sessions or not', () => {
    it('lists the worktrees no session has run in, and starts a session in one', async () => {
      const repo = makeGitWorkdir()
      const quiet = `${repo}-quiet`
      git(repo, 'worktree', 'add', '-q', '-b', 'quiet', quiet)
      try {
        makeSession(projects(), encodeProjectDirNameForTest(repo), {
          sessionId: '11111111-1111-1111-1111-111111111111', cwd: repo, title: 'In the repo',
        })
        await service.refresh()
        await service.importSessions(['11111111-1111-1111-1111-111111111111'], [])

        // The folder itself is not one of its "other" worktrees.
        expect(await service.listWorktrees(repo)).toEqual([{ path: quiet, branch: 'quiet' }])

        const info = await service.newSessionInProject(quiet)
        expect(info.cwd).toBe(quiet)
        expect(service.pty.has(info.ptyId)).toBe(true)
      } finally {
        rmSync(repo, { recursive: true, force: true })
        rmSync(quiet, { recursive: true, force: true })
      }
    })

    it('will not start a session in a folder it was never shown as a worktree', async () => {
      const repo = makeGitWorkdir()
      const quiet = `${repo}-quiet`
      git(repo, 'worktree', 'add', '-q', '-b', 'quiet', quiet)
      try {
        makeSession(projects(), encodeProjectDirNameForTest(repo), {
          sessionId: '11111111-1111-1111-1111-111111111111', cwd: repo, title: 'In the repo',
        })
        await service.refresh()
        await service.importSessions(['11111111-1111-1111-1111-111111111111'], [])
        // Real worktree, but the renderer never learned it from `listWorktrees`: still refused.
        await expect(service.newSessionInProject(quiet)).rejects.toThrow(/unknown project/i)
        await expect(service.listWorktrees('/etc')).rejects.toThrow(/unknown project/i)
      } finally {
        rmSync(repo, { recursive: true, force: true })
        rmSync(quiet, { recursive: true, force: true })
      }
    })

    it('works on a repository shown only because one of its worktrees has sessions', async () => {
      // The sidebar draws a folder for the repository as the heading its worktrees sit under, even
      // when nobody has run Claude in the repository folder itself — so the store has no project
      // row for it. Its menu, "+" and pull button all name it all the same.
      const repo = makeGitWorkdir()
      const used = `${repo}-used`
      const quiet = `${repo}-quiet`
      git(repo, 'worktree', 'add', '-q', '-b', 'used', used)
      git(repo, 'worktree', 'add', '-q', '-b', 'quiet', quiet)
      try {
        makeSession(projects(), encodeProjectDirNameForTest(used), {
          sessionId: '11111111-1111-1111-1111-111111111111', cwd: used, title: 'In a worktree',
        })
        await service.refresh()
        await service.importSessions(['11111111-1111-1111-1111-111111111111'], [])
        expect((await service.tree()).map((n) => n.path)).toEqual([repo])

        // In git's order, which the sidebar re-sorts by label anyway.
        expect((await service.listWorktrees(repo)).sort((a, b) => a.path.localeCompare(b.path))).toEqual([
          { path: quiet, branch: 'quiet' },
          { path: used, branch: 'used' },
        ])
        expect((await service.newSessionInProject(repo)).cwd).toBe(repo)
        expect((await service.newSessionInProject(quiet)).cwd).toBe(quiet)
        // No upstream to pull from, but refused for that reason — not as an unknown folder.
        await expect(service.gitPullFolder(repo)).rejects.not.toThrow(/unknown project/i)
      } finally {
        rmSync(repo, { recursive: true, force: true })
        rmSync(used, { recursive: true, force: true })
        rmSync(quiet, { recursive: true, force: true })
      }
    })

    it('reports no worktrees for a folder that is not a repository', async () => {
      makeSession(projects(), '-w', {
        sessionId: '11111111-1111-1111-1111-111111111111', cwd: workdir, title: 'Plain folder',
      })
      await service.refresh()
      await service.importSessions(['11111111-1111-1111-1111-111111111111'], [])
      expect(await service.listWorktrees(workdir)).toEqual([])
    })
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
    await expect(service.openShellForPty(asPtyId('new:does-not-exist'), '1')).rejects.toThrow(/unknown session/i)
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
    const liveService = buildAppService({
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
    const liveService = buildAppService({
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
      const conflict = await liveService.checkConflict(asSessionId('11111111-1111-1111-1111-111111111111'))
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

  // This drives two real refresh passes back to back (the gated one, then the one it releases
  // into), each doing real filesystem/git work rather than being mocked out. What it actually
  // asserts is an ordering property — that a concurrent refresh() call does not start a second
  // run while one is in flight — which has nothing to do with elapsed time. The timeout below
  // is not a performance budget; its only job is to catch a genuine hang instead of letting the
  // suite run forever.
  it('does not run overlapping refreshes when refresh() is called concurrently', async () => {
    let calls = 0
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const guardedService = buildAppService({
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
      // Waits for the first run to reach detectLive rather than for a fixed 50ms, which a busy
      // machine's scan could outlast (calls was still 0). Then, while it is gated there, a second
      // concurrent call must not have started a second run.
      await vi.waitFor(() => { expect(calls).toBe(1) })
      await stays(() => calls === 1, 50, 'the second refresh() to join the run in flight')
      release()
      await Promise.all([first, second])
    } finally {
      await guardedService.dispose()
    }
  }, 10000)

  it('a refresh() that joins an in-flight run still observes a file written after that run started (Finding 3)', async () => {
    let calls = 0
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const rerunService = buildAppService({
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
      // is now taken and does not include the session written below. Waited for, not a fixed
      // 50ms: a busy machine's scan outlasted that.
      await vi.waitFor(() => { expect(calls).toBe(1) })

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

  it('quitting in the middle of a long rescan does not wait for the rest of it', async () => {
    // Every folder costs a few git calls to resolve, so a library of a few hundred makes a rescan
    // tens of seconds long — and quitting waits for the rescan in flight. It used to wait for all
    // of it, leaving the process running with no window for as long as the rescan had left.
    //
    // Proved by what the interrupted pass reaches, not by how long it takes: a pass that runs to
    // the end asks for live sessions (`detectLive`) after resolving every folder, and one that
    // stops when shutdown starts never gets there. (A timing ratio was tried first and failed on a
    // fast CI runner, where a whole pass took less time than closing the store.)
    const bigHome = mkdtempSync(join(tmpdir(), 'apiary-home-big-'))
    const bigProjects = join(bigHome, '.claude', 'projects')
    mkdirSync(bigProjects, { recursive: true })
    for (let i = 0; i < 60; i++) {
      const cwd = join(bigHome, `work-${String(i)}`)
      mkdirSync(cwd)
      makeSession(bigProjects, `-work-${String(i)}`, {
        sessionId: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
        cwd,
        title: `Session ${String(i)}`,
      })
    }
    let passesFinished = 0
    const big = buildAppService({
      configRoot: join(bigHome, '.claude'),
      dbPath: join(bigHome, 'apiary.db'),
      detectLive: async () => { passesFinished += 1; return new Map() },
    })
    try {
      await big.refresh()
      expect(passesFinished).toBe(1)

      const inFlight = big.refresh().catch(() => {})
      await big.dispose()
      await inFlight

      expect(passesFinished).toBe(1)
    } finally {
      rmSync(bigHome, { recursive: true, force: true })
    }
  }, 30000)

  it('recovers after a refresh rejects so later refreshes still run', async () => {
    let calls = 0
    let shouldFail = true
    const recoveringService = buildAppService({
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
