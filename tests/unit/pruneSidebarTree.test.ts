import { describe, expect, it } from 'vitest'
import type { ProjectNode, SessionNode } from '@shared/types'
import { pruneSidebarTree } from '../../src/renderer/features/sidebar/pruneSidebarTree'

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
const opts = (keep: string[] = [], days: number | null = 30) => ({ days, now: NOW, keep: new Set(keep) })
const ids = (t: ProjectNode[]) => t.flatMap((p) => p.sessions.map((s) => s.sessionId))

describe('pruneSidebarTree', () => {
  it('keeps every old session, and the same tree, when "hide old sessions" is off', () => {
    const t = [folder('/a', [session('old', 99)])]
    expect(pruneSidebarTree(t, opts([], null))).toBe(t)
  })
  it('drops a session whose folder is gone, whether or not old sessions are hidden', () => {
    const t = [folder('/a', [session('gone', 1, { cwdExists: false }), session('here', 1)])]
    expect(ids(pruneSidebarTree(t, opts([], null)))).toEqual(['here'])
    expect(ids(pruneSidebarTree(t, opts()))).toEqual(['here'])
  })
  it('keeps a folder-gone session that is pinned, open or running', () => {
    const gone = { cwdExists: false }
    const t = [folder('/a', [session('pin', 1, gone), session('live', 1, { ...gone, isLive: true }), session('tab', 1, gone), session('x', 1, gone)])]
    expect(ids(pruneSidebarTree(t, opts(['pin', 'tab'], null)))).toEqual(['pin', 'live', 'tab'])
  })
  it('drops a removed worktree folder that held only folder-gone sessions', () => {
    const t = [folder('/a', [session('here', 1)], [folder('/a/agent-1', [session('gone', 1, { cwdExists: false })])])]
    const out = pruneSidebarTree(t, opts([], null))
    expect(out[0]?.children).toEqual([])
    expect(ids(out)).toEqual(['here'])
  })
  it('hides older than N days and keeps exactly N', () => {
    const t = [folder('/a', [session('old', 31), session('edge', 30), session('new', 1)])]
    expect(ids(pruneSidebarTree(t, opts()))).toEqual(['edge', 'new'])
  })
  it('keeps pinned, open and running sessions', () => {
    const t = [folder('/a', [session('pin', 90), session('live', 90, { isLive: true }), session('gone', 90)])]
    expect(ids(pruneSidebarTree(t, opts(['pin'])))).toEqual(['pin', 'live'])
  })
  it('keeps a parent folder for a recent child', () => {
    const t = [folder('/a', [session('old', 90)], [folder('/a/wt', [session('new', 2)])])]
    const out = pruneSidebarTree(t, opts())
    expect(out[0]?.children[0]?.sessions).toHaveLength(1)
    expect(out[0]?.sessions).toHaveLength(0)
  })
  it('drops a folder the filter emptied, but not one that was empty', () => {
    const t = [folder('/a', [session('old', 90)]), folder('/empty', [])]
    expect(pruneSidebarTree(t, opts()).map((p) => p.path)).toEqual(['/empty'])
  })
})
