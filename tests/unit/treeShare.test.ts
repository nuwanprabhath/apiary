import { must } from './support/must'
import { describe, it, expect } from 'vitest'
import type { ProjectNode, SessionNode } from '@shared/types'
import { shareTree } from '../../src/renderer/state/treeShare'

function session(id: string, title = 't'): SessionNode {
  return {
    kind: 'session', sessionId: id as SessionNode['sessionId'], title, cwd: '/p', gitBranch: null,
    lastActiveAtMs: 1, messageCount: 2, isLive: false, cwdExists: true, note: null,
  }
}
function project(path: string, sessions: SessionNode[], children: ProjectNode[] = []): ProjectNode {
  return { kind: 'project', path, label: path, branch: null, isWorktree: false, children, sessions }
}
const clone = <T,>(v: T): T => structuredClone(v)

describe('shareTree', () => {
  it('returns the previous tree itself when nothing changed', () => {
    const prev = [project('/a', [session('1'), session('2')], [project('/a/w', [session('3')])])]
    expect(shareTree(prev, clone(prev))).toBe(prev)
  })

  it('keeps identity of every node but the changed one and its ancestors', () => {
    const prev = [project('/a', [session('1'), session('2')]), project('/b', [session('3')])]
    const next = clone(prev)
    must(must(next[0]).sessions[1]).title = 'changed'
    const out = shareTree(prev, next)
    expect(out).not.toBe(prev)
    expect(out[1]).toBe(prev[1])
    expect(out[0]).not.toBe(prev[0])
    expect(must(out[0]).sessions[0]).toBe(must(prev[0]).sessions[0])
    expect(must(must(out[0]).sessions[1]).title).toBe('changed')
  })

  it('shares reordered sessions by value but reports a new array', () => {
    const prev = [project('/a', [session('1'), session('2')])]
    const next = clone(prev)
    must(next[0]).sessions.reverse()
    const out = shareTree(prev, next)
    expect(out[0]).not.toBe(prev[0])
    expect(must(out[0]).sessions[0]).toBe(must(prev[0]).sessions[1])
    expect(must(out[0]).sessions[1]).toBe(must(prev[0]).sessions[0])
  })

  it('handles empty trees and new projects', () => {
    const empty: ProjectNode[] = []
    expect(shareTree(empty, [])).toBe(empty)
    const next = [project('/a', [])]
    expect(shareTree(empty, next)).toEqual(next)
  })
})
