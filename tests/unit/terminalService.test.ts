import { asSessionId } from '@shared/domain/ids'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stubAccounts, WORK } from '../fixtures/launchAccounts'
import { TerminalService } from '../../src/main/terminals/terminalService'
import { WorktreeResolver } from '../../src/main/git/worktreeResolver'
import { SessionResolver } from '../../src/main/sessions/sessionResolver'
import type { PtyManager, SpawnOptions } from '../../src/main/pty/ptyManager'
import type { SessionStore, StoredSession } from '../../src/main/store/sessionStore'

/** A resolver whose `git` never answers: every folder is "not a repository", and nothing spawns. */
const worktrees = new WorktreeResolver({ exec: async () => { throw new Error('not a git repository') } })

const SID = '11111111-1111-1111-1111-111111111111'

/** A narrow fake of just the `PtyManager` surface `TerminalService` calls. `write` is returned
 *  alongside rather than left on the `PtyManager`-typed object, so a caller that wants to assert
 *  on it does not trigger eslint's `unbound-method` check for pulling a method off a typed value. */
function fakePty(running: Set<string> = new Set()): { pty: PtyManager; spawned: SpawnOptions[]; killed: string[]; write: ReturnType<typeof vi.fn> } {
  const spawned: SpawnOptions[] = []
  const killed: string[] = []
  const write = vi.fn()
  const pty = {
    has: (id: string) => running.has(id),
    getCwd: () => undefined,
    spawn: (opts: SpawnOptions) => { spawned.push(opts); running.add(opts.id) },
    killAndWait: async (id: string) => { running.delete(id); killed.push(id) },
    sizeOf: () => ({ cols: 132, rows: 40 }),
    whenQuiet: async () => {},
    outputCount: () => 0,
    write,
  } as unknown as PtyManager
  return { pty, spawned, killed, write }
}

function fakeStore(opts: {
  sessions?: Record<string, StoredSession | null>
  projects?: Record<string, { path: string } | null>
}): SessionStore {
  return {
    getSession: (id: string) => opts.sessions?.[id] ?? null,
    getProject: (path: string) => opts.projects?.[path] ?? null,
    isRepoRootOfWorktree: () => false,
    setAutoImport: () => {},
    syncProject: () => {},
  } as unknown as SessionStore
}

describe('TerminalService', () => {
  let realDir: string
  beforeEach(() => {
    realDir = mkdtempSync(join(tmpdir(), 'apiary-terminalservice-'))
  })
  afterEach(() => {
    rmSync(realDir, { recursive: true, force: true })
  })

  describe('resume', () => {
    it('attaches instead of spawning when the pty is already live', async () => {
      const { pty, spawned } = fakePty(new Set([SID]))
      const store = fakeStore({ sessions: { [SID]: { sessionId: SID, cwd: realDir } as StoredSession } })
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store, worktrees, accounts: stubAccounts(), homeDir: '/home' })
      await terminals.resume(SID)
      expect(spawned).toHaveLength(0)
    })

    it('spawns claude --resume in the session cwd when not already running', async () => {
      const { pty, spawned } = fakePty()
      const session = { sessionId: SID, cwd: realDir } as StoredSession
      const store = fakeStore({ sessions: { [SID]: session } })
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store, worktrees, accounts: stubAccounts(), homeDir: '/home' })
      await terminals.resume(SID)
      expect(spawned).toHaveLength(1)
      expect(spawned[0]).toMatchObject({ id: SID, cwd: realDir, tui: true })
      expect(spawned[0].command).toContain('--resume')
    })

    it('throws when the session cwd no longer exists', async () => {
      const store = fakeStore({ sessions: { [SID]: { sessionId: SID, cwd: '/not/a/real/path' } as StoredSession } })
      const { pty } = fakePty()
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store, worktrees, accounts: stubAccounts(), homeDir: '/home' })
      await expect(terminals.resume(SID)).rejects.toThrow('no longer exists')
    })
  })

  describe('openShell / openShellForPty', () => {
    it('attaches instead of spawning when the shell pty already exists', async () => {
      const store = fakeStore({ sessions: { [SID]: { sessionId: SID, cwd: realDir } as StoredSession } })
      const { pty, spawned } = fakePty(new Set([`shell:${SID}:1`]))
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store, worktrees, accounts: stubAccounts(), homeDir: '/home' })
      await terminals.openShell(asSessionId(SID), '1')
      expect(spawned).toHaveLength(0)
    })

    it('spawns a login shell in the resolved cwd', async () => {
      const store = fakeStore({ sessions: { [SID]: { sessionId: SID, cwd: realDir } as StoredSession } })
      const { pty, spawned } = fakePty()
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store, worktrees, accounts: stubAccounts(), homeDir: '/home' })
      await terminals.openShell(asSessionId(SID), '1')
      expect(spawned[0]).toMatchObject({ id: `shell:${SID}:1`, cwd: realDir, command: 'exec "$SHELL" -l' })
    })
  })

  describe('forkSession', () => {
    it('spawns a fork under a new pending pty id, labelled from the original', () => {
      const store = fakeStore({ sessions: { [SID]: { sessionId: SID, cwd: realDir, title: 'My Session' } as StoredSession } })
      const { pty, spawned } = fakePty()
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store, worktrees, accounts: stubAccounts(), homeDir: '/home' })
      const info = terminals.forkSession(SID)
      expect(info.cwd).toBe(realDir)
      expect(info.ptyId.startsWith('new:')).toBe(true)
      expect(spawned[0].command).toContain('--fork-session')
    })

    it('throws when the original session cwd no longer exists', () => {
      const store = fakeStore({ sessions: { [SID]: { sessionId: SID, cwd: '/gone' } as StoredSession } })
      const { pty } = fakePty()
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store, worktrees, accounts: stubAccounts(), homeDir: '/home' })
      expect(() => terminals.forkSession(SID)).toThrow('no longer exists')
    })
  })

  describe('accounts', () => {
    const build = (running: Set<string>, accounts = stubAccounts()) => {
      const store = fakeStore({ sessions: { [SID]: { sessionId: SID, cwd: realDir } as StoredSession } })
      const fake = fakePty(running)
      const terminals = new TerminalService({
        pty: fake.pty, resolver: new SessionResolver({ store, pty: fake.pty }), store, worktrees, accounts, homeDir: realDir,
      })
      return { terminals, accounts, ...fake }
    }

    it('switching a running terminal respawns the resume command on the same pty id with the new env', async () => {
      const accounts = stubAccounts()
      const { terminals, spawned, killed } = build(new Set([SID]), accounts)
      accounts.stored.set(SID, WORK)
      await terminals.respawn(asSessionId(SID))
      expect(killed).toEqual([SID])
      expect(spawned).toHaveLength(1)
      expect(spawned[0]).toMatchObject({ id: SID, cwd: realDir, tui: true, account: WORK, cols: 132, rows: 40 })
      expect(spawned[0].command).toContain(`--resume ${SID}`)
      expect(spawned[0].env).toMatchObject({ CLAUDE_CONFIG_DIR: '/accounts/work' })
    })

    it('resumes under the session\'s account, and a main session gets no config folder', async () => {
      const accounts = stubAccounts()
      accounts.stored.set(SID, WORK)
      const work = build(new Set(), accounts)
      await work.terminals.resume(SID)
      expect(work.spawned[0]).toMatchObject({ account: WORK, env: { CLAUDE_CONFIG_DIR: '/accounts/work' } })
      const main = build(new Set())
      await main.terminals.resume(SID)
      expect(main.spawned[0].env).not.toHaveProperty('CLAUDE_CONFIG_DIR')
    })

    it('a fork starts in its parent\'s account, a new session in the default one', async () => {
      const accounts = stubAccounts()
      accounts.stored.set(SID, WORK)
      const fork = build(new Set(), accounts)
      fork.terminals.forkSession(SID)
      expect(fork.spawned[0]).toMatchObject({ account: WORK, env: { CLAUDE_CONFIG_DIR: '/accounts/work' } })
      const fresh = build(new Set(), stubAccounts(WORK))
      await fresh.terminals.newSessionInFolder(realDir)
      expect(fresh.spawned[0]).toMatchObject({ account: WORK, env: { CLAUDE_CONFIG_DIR: '/accounts/work' } })
    })

    it('a login is a pending terminal under that account, in the home folder', () => {
      const { terminals, spawned } = build(new Set())
      const info = terminals.login(WORK)
      expect(info.ptyId.startsWith('new:')).toBe(true)
      expect(spawned[0]).toMatchObject({ cwd: realDir, account: WORK, env: { CLAUDE_CONFIG_DIR: '/accounts/work' } })
    })
  })

  describe('newSessionInFolder', () => {
    it('throws when the folder does not exist', async () => {
      const store = fakeStore({})
      const { pty } = fakePty()
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store, worktrees, accounts: stubAccounts(), homeDir: '/home' })
      await expect(terminals.newSessionInFolder('/definitely/not/real')).rejects.toThrow('does not exist')
    })
  })

  describe('claudeBin', () => {
    it('defaults to null, and setClaudeBin changes what resume() spawns', async () => {
      const store = fakeStore({ sessions: { [SID]: { sessionId: SID, cwd: realDir } as StoredSession } })
      const { pty, spawned } = fakePty()
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store, worktrees, accounts: stubAccounts(), homeDir: '/home' })
      expect(terminals.getClaudeBin()).toBeNull()
      terminals.setClaudeBin('/opt/claude')
      expect(terminals.getClaudeBin()).toBe('/opt/claude')
      await terminals.resume(SID)
      expect(spawned[0].command).toContain('/opt/claude')
    })
  })

  describe('sendPrompt', () => {
    it('throws when the pty is not running', async () => {
      const { pty } = fakePty()
      const store = fakeStore({})
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store, worktrees, accounts: stubAccounts(), homeDir: '/home' })
      await expect(terminals.sendPrompt('nope', 'hello')).rejects.toThrow('not running')
    })

    it('writes a bracketed paste followed by a carriage return', async () => {
      const { pty, write } = fakePty(new Set(['p1']))
      const store = fakeStore({})
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store, worktrees, accounts: stubAccounts(), homeDir: '/home' })
      await terminals.sendPrompt('p1', 'hello world')
      expect(write).toHaveBeenCalledWith('p1', '\x1b[200~hello world\x1b[201~')
      expect(write).toHaveBeenCalledWith('p1', '\r')
    })

    it('does nothing for an empty (whitespace-only) prompt', async () => {
      const { pty, write } = fakePty(new Set(['p1']))
      const store = fakeStore({})
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store, worktrees, accounts: stubAccounts(), homeDir: '/home' })
      await terminals.sendPrompt('p1', '   \n  ')
      expect(write).not.toHaveBeenCalled()
    })
  })
})
