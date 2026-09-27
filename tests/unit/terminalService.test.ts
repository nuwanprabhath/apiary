import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TerminalService } from '../../src/main/terminals/terminalService'
import { SessionResolver } from '../../src/main/sessions/sessionResolver'
import type { PtyManager, SpawnOptions } from '../../src/main/pty/ptyManager'
import type { SessionStore, StoredSession } from '../../src/main/store/sessionStore'

const SID = '11111111-1111-1111-1111-111111111111'

/** A narrow fake of just the `PtyManager` surface `TerminalService` calls. `write` is returned
 *  alongside rather than left on the `PtyManager`-typed object, so a caller that wants to assert
 *  on it does not trigger eslint's `unbound-method` check for pulling a method off a typed value. */
function fakePty(running: Set<string> = new Set()): { pty: PtyManager; spawned: SpawnOptions[]; write: ReturnType<typeof vi.fn> } {
  const spawned: SpawnOptions[] = []
  const write = vi.fn()
  const pty = {
    has: (id: string) => running.has(id),
    getCwd: () => undefined,
    spawn: (opts: SpawnOptions) => { spawned.push(opts); running.add(opts.id) },
    whenQuiet: async () => {},
    outputCount: () => 0,
    write,
  } as unknown as PtyManager
  return { pty, spawned, write }
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
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store })
      await terminals.resume(SID)
      expect(spawned).toHaveLength(0)
    })

    it('spawns claude --resume in the session cwd when not already running', async () => {
      const { pty, spawned } = fakePty()
      const session = { sessionId: SID, cwd: realDir } as StoredSession
      const store = fakeStore({ sessions: { [SID]: session } })
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store })
      await terminals.resume(SID)
      expect(spawned).toHaveLength(1)
      expect(spawned[0]).toMatchObject({ id: SID, cwd: realDir, tui: true })
      expect(spawned[0].command).toContain('--resume')
    })

    it('throws when the session cwd no longer exists', async () => {
      const store = fakeStore({ sessions: { [SID]: { sessionId: SID, cwd: '/not/a/real/path' } as StoredSession } })
      const { pty } = fakePty()
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store })
      await expect(terminals.resume(SID)).rejects.toThrow('no longer exists')
    })
  })

  describe('openShell / openShellForPty', () => {
    it('attaches instead of spawning when the shell pty already exists', async () => {
      const store = fakeStore({ sessions: { [SID]: { sessionId: SID, cwd: realDir } as StoredSession } })
      const { pty, spawned } = fakePty(new Set([`shell:${SID}:1`]))
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store })
      await terminals.openShell(SID, '1')
      expect(spawned).toHaveLength(0)
    })

    it('spawns a login shell in the resolved cwd', async () => {
      const store = fakeStore({ sessions: { [SID]: { sessionId: SID, cwd: realDir } as StoredSession } })
      const { pty, spawned } = fakePty()
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store })
      await terminals.openShell(SID, '1')
      expect(spawned[0]).toMatchObject({ id: `shell:${SID}:1`, cwd: realDir, command: 'exec "$SHELL" -l' })
    })
  })

  describe('forkSession', () => {
    it('spawns a fork under a new pending pty id, labelled from the original', () => {
      const store = fakeStore({ sessions: { [SID]: { sessionId: SID, cwd: realDir, title: 'My Session' } as StoredSession } })
      const { pty, spawned } = fakePty()
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store })
      const info = terminals.forkSession(SID)
      expect(info.cwd).toBe(realDir)
      expect(info.ptyId.startsWith('new:')).toBe(true)
      expect(spawned[0].command).toContain('--fork-session')
    })

    it('throws when the original session cwd no longer exists', () => {
      const store = fakeStore({ sessions: { [SID]: { sessionId: SID, cwd: '/gone' } as StoredSession } })
      const { pty } = fakePty()
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store })
      expect(() => terminals.forkSession(SID)).toThrow('no longer exists')
    })
  })

  describe('newSessionInFolder', () => {
    it('throws when the folder does not exist', async () => {
      const store = fakeStore({})
      const { pty } = fakePty()
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store })
      await expect(terminals.newSessionInFolder('/definitely/not/real')).rejects.toThrow('does not exist')
    })
  })

  describe('claudeBin', () => {
    it('defaults to null, and setClaudeBin changes what resume() spawns', async () => {
      const store = fakeStore({ sessions: { [SID]: { sessionId: SID, cwd: realDir } as StoredSession } })
      const { pty, spawned } = fakePty()
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store })
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
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store })
      await expect(terminals.sendPrompt('nope', 'hello')).rejects.toThrow('not running')
    })

    it('writes a bracketed paste followed by a carriage return', async () => {
      const { pty, write } = fakePty(new Set(['p1']))
      const store = fakeStore({})
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store })
      await terminals.sendPrompt('p1', 'hello world')
      expect(write).toHaveBeenCalledWith('p1', '\x1b[200~hello world\x1b[201~')
      expect(write).toHaveBeenCalledWith('p1', '\r')
    })

    it('does nothing for an empty (whitespace-only) prompt', async () => {
      const { pty, write } = fakePty(new Set(['p1']))
      const store = fakeStore({})
      const terminals = new TerminalService({ pty, resolver: new SessionResolver({ store, pty }), store })
      await terminals.sendPrompt('p1', '   \n  ')
      expect(write).not.toHaveBeenCalled()
    })
  })
})
