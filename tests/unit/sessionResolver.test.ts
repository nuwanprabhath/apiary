import { terminalRef } from '@shared/domain/ids'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionResolver } from '../../src/main/sessions/sessionResolver'
import type { SessionStore, StoredSession } from '../../src/main/store/sessionStore'
import type { PtyManager } from '../../src/main/pty/ptyManager'

/** A narrow fake of just the two `SessionStore` methods `SessionResolver` reads, and the
 *  `isRepoRootOfWorktree` check `requireFolder` falls back to. */
function fakeStore(opts: {
  sessions?: Record<string, StoredSession | null>
  projects?: Record<string, { path: string } | null>
  repoRoots?: Set<string>
}): SessionStore {
  return {
    getSession: (id: string) => opts.sessions?.[id] ?? null,
    getProject: (path: string) => opts.projects?.[path] ?? null,
    isRepoRootOfWorktree: (path: string) => opts.repoRoots?.has(path) ?? false,
  } as unknown as SessionStore
}

function fakePty(cwds: Record<string, string | undefined>): PtyManager {
  return { getCwd: (id: string) => cwds[id] } as unknown as PtyManager
}

describe('SessionResolver', () => {
  describe('requireSession', () => {
    it('returns a known session', () => {
      const session = { sessionId: 's1', cwd: '/x' } as StoredSession
      const resolver = new SessionResolver({ store: fakeStore({ sessions: { s1: session } }), pty: fakePty({}) })
      expect(resolver.requireSession('s1')).toBe(session)
    })

    it('throws "Unknown session" for an unknown id', () => {
      const resolver = new SessionResolver({ store: fakeStore({}), pty: fakePty({}) })
      expect(() => resolver.requireSession('nope')).toThrow('Unknown session: nope')
    })
  })

  describe('requireFolder', () => {
    it('returns a stored project\'s path', () => {
      const resolver = new SessionResolver({
        store: fakeStore({ projects: { '/p': { path: '/p' } } }),
        pty: fakePty({}),
      })
      expect(resolver.requireFolder('/p')).toBe('/p')
    })

    it('returns the path as-is when it is a repo root of a known worktree', () => {
      const resolver = new SessionResolver({
        store: fakeStore({ repoRoots: new Set(['/repo']) }),
        pty: fakePty({}),
      })
      expect(resolver.requireFolder('/repo')).toBe('/repo')
    })

    it('throws "Unknown project" otherwise', () => {
      const resolver = new SessionResolver({ store: fakeStore({}), pty: fakePty({}) })
      expect(() => resolver.requireFolder('/nope')).toThrow('Unknown project: /nope')
    })
  })

  describe('resolveShellCwd', () => {
    let realDir: string
    beforeEach(() => {
      realDir = mkdtempSync(join(tmpdir(), 'apiary-resolver-'))
    })
    afterEach(() => {
      rmSync(realDir, { recursive: true, force: true })
    })

    it('resolves a pty id through PtyManager.getCwd when isPtyId is true', () => {
      const resolver = new SessionResolver({ store: fakeStore({}), pty: fakePty({ 'new:1': realDir }) })
      expect(resolver.resolveShellCwd(terminalRef('new:1', true))).toBe(realDir)
    })

    it('resolves a session id through the store when isPtyId is false', () => {
      const session = { sessionId: 's1', cwd: realDir } as StoredSession
      const resolver = new SessionResolver({ store: fakeStore({ sessions: { s1: session } }), pty: fakePty({}) })
      expect(resolver.resolveShellCwd(terminalRef('s1', false))).toBe(realDir)
    })

    it('throws "Unknown session" when the pty id has no cwd', () => {
      const resolver = new SessionResolver({ store: fakeStore({}), pty: fakePty({}) })
      expect(() => resolver.resolveShellCwd(terminalRef('new:1', true))).toThrow('Unknown session: new:1')
    })

    it('throws when the resolved cwd no longer exists on disk', () => {
      const session = { sessionId: 's1', cwd: '/definitely/not/a/real/path' } as StoredSession
      const resolver = new SessionResolver({ store: fakeStore({ sessions: { s1: session } }), pty: fakePty({}) })
      expect(() => resolver.resolveShellCwd(terminalRef('s1', false)))
        .toThrow('The folder for this session no longer exists: /definitely/not/a/real/path')
    })
  })

  describe('listed worktrees', () => {
    it('remembers a worktree path and reports it back as known', () => {
      const resolver = new SessionResolver({ store: fakeStore({}), pty: fakePty({}) })
      expect(resolver.isKnownWorktree('/wt')).toBe(false)
      resolver.rememberWorktree('/wt')
      expect(resolver.isKnownWorktree('/wt')).toBe(true)
    })
  })
})
