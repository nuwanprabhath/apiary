import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  existsSync,
  writeFileSync,
  readFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
    await expect(service.resume('11111111-1111-1111-1111-111111111111'))
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

  it('attaches to a shell that is already running rather than replacing it', async () => {
    // Shell tab ids are minted per window and the first is always `1`, so a session open in two
    // windows asked for the very same pty id — and `spawn` kills whatever is under an id before
    // taking it. A build, a `tail -f` or an editor running in the first window's shell died the
    // moment a second window showed that session, with nothing said about it.
    makeSession(projects(), '-w', {
      sessionId: '22222222-2222-2222-2222-222222222222', cwd: workdir, title: 'Shared shell',
    })
    await service.refresh()
    await service.importSessions(['22222222-2222-2222-2222-222222222222'], [])
    const id = 'shell:22222222-2222-2222-2222-222222222222:1'

    await service.openShell('22222222-2222-2222-2222-222222222222', '1')
    // Something running in that shell, which must survive the second window opening it.
    service.pty.write(id, 'MARKER=alive\n')
    await service.openShell('22222222-2222-2222-2222-222222222222', '1')

    service.pty.write(id, 'echo "still:$MARKER"\n')
    const seen = await new Promise<string>((resolve) => {
      let buffer = ''
      service.pty.onData((gotId, data) => {
        if (gotId !== id) return
        buffer += data
        if (buffer.includes('still:alive')) resolve(buffer)
      })
    })
    expect(seen).toContain('still:alive')
  })
})

describe('auto-import all', () => {
  it('importAllDiscovered marks all unimported sessions as imported and returns count', async () => {
    makeSession(projects(), '-w', {
      sessionId: '11111111-1111-1111-1111-111111111111', cwd: workdir, title: 'First',
    })
    makeSession(projects(), '-w', {
      sessionId: '22222222-2222-2222-2222-222222222222', cwd: workdir, title: 'Second',
    })
    await service.refresh()

    // Neither session is imported yet.
    let discovered = await service.discovered()
    expect(discovered.filter((s) => !s.imported)).toHaveLength(2)
    expect(discovered.filter((s) => s.imported)).toHaveLength(0)

    // importAllDiscovered marks all unimported sessions as imported.
    const count = await service.importAllDiscovered()
    expect(count).toBe(2)

    discovered = await service.discovered()
    expect(discovered.filter((s) => s.imported)).toHaveLength(2)

    // Calling it again returns 0 since everything is already imported.
    const secondCount = await service.importAllDiscovered()
    expect(secondCount).toBe(0)
  })

  it('refresh with autoImportAll enabled imports newly discovered sessions', async () => {
    // Create service with autoImportAll enabled.
    const autoService = new AppService({
      configRoot: join(home, '.claude'),
      dbPath: join(home, 'apiary-auto.db'),
      autoImportAll: true,
      detectLive: async () => new Map(),
    })
    try {
      makeSession(projects(), '-w', {
        sessionId: '33333333-3333-3333-3333-333333333333', cwd: workdir, title: 'Auto-imported 1',
      })
      await autoService.refresh()

      // After refresh, the session should be automatically imported since autoImportAll is on.
      let tree = await autoService.tree()
      expect(tree).toHaveLength(1)
      expect(tree[0].sessions[0].title).toBe('Auto-imported 1')

      // New session discovered after the first refresh should also be auto-imported.
      makeSession(projects(), '-w2', {
        sessionId: '44444444-4444-4444-4444-444444444444', cwd: workdir, title: 'Auto-imported 2',
      })
      await autoService.refresh()

      tree = await autoService.tree()
      expect(tree[0].sessions.map((s) => s.title).sort()).toEqual([
        'Auto-imported 1',
        'Auto-imported 2',
      ])
    } finally {
      await autoService.dispose()
    }
  })
})

describe('composer: images and prompt delivery', () => {
  const tinyPng =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  it('saves a pasted image and reads it back as a data URL', async () => {
    const path = await service.saveImage(tinyPng, 'image/png')
    expect(path.endsWith('.png')).toBe(true)
    expect(existsSync(path)).toBe(true)

    const read = await service.readImage(path)
    expect(read?.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    // Round-trips byte for byte: the thumbnail is the image that was pasted, not a re-encoding.
    expect(read?.dataUrl.split(',')[1]).toBe(tinyPng)
  })

  it('refuses an image type it has no extension for, rather than guessing one', async () => {
    await expect(service.saveImage(tinyPng, 'image/svg+xml')).rejects.toThrow(/Unsupported image type/)
  })

  it('will not read a file outside its own images directory', async () => {
    // The renderer supplies these paths, so this is a trust boundary, not a tidiness rule: an
    // unconstrained "read any file as a data URL" would be a way to exfiltrate anything the app
    // can see. `..` must not climb out of it either.
    const outside = join(home, 'secret.png')
    writeFileSync(outside, Buffer.from(tinyPng, 'base64'))
    expect(await service.readImage(outside)).toBeNull()

    const inside = await service.saveImage(tinyPng, 'image/png')
    const climbing = join(dirname(inside), '..', '..', 'secret.png')
    expect(await service.readImage(climbing)).toBeNull()
  })

  it('delivers a multi-line prompt as one paste, so it is not submitted a line at a time', async () => {
    makeSession(projects(), '-w', {
      sessionId: '11111111-1111-1111-1111-111111111111', cwd: workdir, title: 'Fix CSV export',
    })
    await service.refresh()
    await service.importSessions(['11111111-1111-1111-1111-111111111111'], [])
    await service.openShell('11111111-1111-1111-1111-111111111111', '1')
    const ptyId = 'shell:11111111-1111-1111-1111-111111111111:1'

    const chunks: string[] = []
    service.pty.onData((id, data) => { if (id === ptyId) chunks.push(data) })
    await service.sendPrompt(ptyId, 'echo APIARY_LINE_ONE\necho APIARY_LINE_TWO')

    // A real shell, receiving a real bracketed paste: both lines arrive, and the trailing return
    // is what runs them. If the paste markers were missing, the first newline would submit on its
    // own and the second line would be typed at a fresh prompt instead.
    await vi.waitFor(() => {
      const seen = chunks.join('')
      expect(seen).toContain('APIARY_LINE_ONE')
      expect(seen).toContain('APIARY_LINE_TWO')
    }, { timeout: 15000 })
  })

  it('refuses to send to a session that is not running', async () => {
    await expect(service.sendPrompt('shell:nope:1', 'hello')).rejects.toThrow(/not running/i)
  })

  it('waits for a slow-starting TUI, so the prompt is not eaten by the line discipline', async () => {
    // The bug this covers: sending a message resumes a stopped session first, and the pty exists a
    // good second before `claude` is listening. Written into that gap, the prompt is handled by the
    // terminal's line discipline instead of the program — which buffers it and, fatally, translates
    // the submitting carriage return into a newline (ICRNL). The message then appears in the input
    // box and just sits there, needing an Enter by hand. Reproduced against the real `claude` before
    // this was fixed; this stand-in is that behaviour without the API calls: quiet and in canonical
    // mode at first, then taking the screen and switching to raw mode the way a full-screen program
    // does, recording what it is actually handed.
    const received = join(home, 'tui-received.log')
    const fakeTui = join(home, 'fake-tui.cjs')
    writeFileSync(fakeTui, `
      const fs = require('fs')
      setTimeout(() => {
        process.stdin.setRawMode(true)
        process.stdout.write('\\u001b[?1049h')
        process.stdin.on('data', (d) => fs.appendFileSync(${JSON.stringify(received)}, d.toString('binary')))
      }, 600)
      setTimeout(() => process.exit(0), 10000)
    `)

    service.pty.spawn({
      id: 'tui-probe',
      cwd: workdir,
      command: `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeTui)}`,
      tui: true,
    })
    await service.sendPrompt('tui-probe', 'line one\nline two')

    await vi.waitFor(() => {
      const seen = readFileSync(received, 'latin1')
      // The paste arrived whole, as a paste...
      expect(seen).toContain('\x1b[200~line one\nline two\x1b[201~')
      // ...and the send is a carriage return. A newline here means it was written before the
      // program was listening and the line discipline rewrote it — the original bug exactly.
      expect(seen.endsWith('\r')).toBe(true)
    }, { timeout: 5000 })
    service.pty.kill('tui-probe')
  }, 15000)
})

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

    // The identifier forms people actually type, and a plain word from the note.
    for (const query of ['nightly', '!1257', '1257', 'dev/1.0.12']) {
      expect(await service.tree(query)).toHaveLength(1)
    }
  })

  it('searching a note is immediate — it does not wait for the next index pass', async () => {
    await seed()
    await service.setSessionNote(ID, 'carburettor')
    expect(service.searchSessions('carburettor')).toEqual([ID])
  })

  it('stops matching once the note is changed, so an old note cannot haunt the results', async () => {
    await seed()
    await service.setSessionNote(ID, 'carburettor')
    await service.setSessionNote(ID, 'gearbox')

    expect(service.searchSessions('carburettor')).toEqual([])
    expect(service.searchSessions('gearbox')).toEqual([ID])
  })

  it('rejects a note on an unknown session', async () => {
    await expect(service.setSessionNote('does-not-exist', 'hi')).rejects.toThrow(/unknown session/i)
  })

  it('notes stay searchable when transcript indexing is off — they are separate settings', async () => {
    await seed()
    service.setSearchChatContent(false)
    await service.setSessionNote(ID, 'nightly pipeline')
    expect(service.searchSessions('nightly')).toEqual([ID])
  })

  it('turning note search off stops matching, and turning it back on restores it', async () => {
    await seed()
    await service.setSessionNote(ID, 'nightly pipeline')

    service.setSearchSessionNotes(false)
    expect(service.searchSessions('nightly')).toEqual([])
    // The note itself is untouched — it is the user's writing, not derived data.
    expect(service.sessionNote(ID)).toBe('nightly pipeline')

    service.setSearchSessionNotes(true)
    expect(service.searchSessions('nightly')).toEqual([ID])
  })

  it('picks up notes written while note indexing was switched off', async () => {
    await seed()
    service.setSearchSessionNotes(false)
    await service.setSessionNote(ID, 'written while off')

    service.setSearchSessionNotes(true)
    expect(service.searchSessions('written')).toEqual([ID])
  })

  it('a rebuild restores the note index from the notes themselves', async () => {
    await seed()
    await service.setSessionNote(ID, 'nightly pipeline')
    await service.rebuildSearchIndex()
    expect(service.searchSessions('nightly')).toEqual([ID])
  })
})

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
    expect(service.searchSessions('1257')).toEqual([ID])

    service.setSearchSessionNotes(undefined as unknown as boolean)

    expect(service.searchNoteCount()).toBe(1)
    expect(service.searchSessions('1257')).toEqual([ID])
    // And a note written afterwards is still indexed, rather than the feature being half-off.
    await service.setSessionNote(ID, 'now about MR !1300')
    expect(service.searchSessions('1300')).toEqual([ID])
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
    expect(service.searchSessions('nightly')).toEqual([])
  })
})
