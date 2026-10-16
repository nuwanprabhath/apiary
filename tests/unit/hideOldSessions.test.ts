import { describe, expect, it } from 'vitest'
import type { ProjectNode, SessionNode } from '@shared/types'
import { hideOldSessions } from '../../src/renderer/features/sidebar/hideOldSessions'

const NOW = Date.UTC(2026, 5, 30)
const DAY = 86_400_000
const session = (id: string, ageDays: number, extra: Partial<SessionNode> = {}): SessionNode => ({
  kind: 'session', sessionId: id as SessionNode['sessionId'], title: id, cwd: '/p', gitBranch: null,
  lastActiveAtMs: NOW - ageDays * DAY, messageCount: 1, isLive: false, cwdExists: true,
  note: null, ...extra,
})
const folder = (path: string, sessions: SessionNode[], children: ProjectNode[] = []): ProjectNode => ({
  kind: 'project', path, label: path, branch: null, isWorktree: false, children, sessions,
})
const opts = (keep: string[] = []) => ({ days: 30, now: NOW, keep: new Set(keep) })
const ids = (t: ProjectNode[]) => t.flatMap((p) => p.sessions.map((s) => s.sessionId))

describe('hideOldSessions', () => {
  it('is the identity when off', () => {
    const t = [folder('/a', [session('old', 99)])]
    expect(hideOldSessions(t, null)).toBe(t)
  })
  it('hides older than N days and keeps exactly N', () => {
    const t = [folder('/a', [session('old', 31), session('edge', 30), session('new', 1)])]
    expect(ids(hideOldSessions(t, opts()))).toEqual(['edge', 'new'])
  })
  it('keeps pinned, open and running sessions', () => {
    const t = [folder('/a', [session('pin', 90), session('live', 90, { isLive: true }), session('gone', 90)])]
    expect(ids(hideOldSessions(t, opts(['pin'])))).toEqual(['pin', 'live'])
  })
  it('keeps a parent folder for a recent child', () => {
    const t = [folder('/a', [session('old', 90)], [folder('/a/wt', [session('new', 2)])])]
    const out = hideOldSessions(t, opts())
    expect(out[0]?.children[0]?.sessions).toHaveLength(1)
    expect(out[0]?.sessions).toHaveLength(0)
  })
  it('drops a folder the filter emptied, but not one that was empty', () => {
    const t = [folder('/a', [session('old', 90)]), folder('/empty', [])]
    expect(hideOldSessions(t, opts()).map((p) => p.path)).toEqual(['/empty'])
  })
})
