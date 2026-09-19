import { describe, it, expect } from 'vitest'
import { fuzzyScore } from '../../src/shared/fuzzy'
import { filterTreeLocal } from '../../src/shared/treeFilter'
import type { ProjectNode } from '../../src/shared/types'

describe('fuzzyScore', () => {
  it('matches a subsequence regardless of case', () => {
    expect(fuzzyScore('CSV', 'fix csv bug')).not.toBeNull()
  })
  it('rejects a non-subsequence', () => {
    expect(fuzzyScore('xyz', 'Fix CSV export')).toBeNull()
  })
})

const proj = (path: string, sessions: ProjectNode['sessions'] = []): ProjectNode => ({
  kind: 'project', path, label: path.split('/').pop() ?? path, branch: null,
  isWorktree: false, children: [], sessions,
})

describe('filterTreeLocal', () => {
  it('keeps a project whose session title matches', () => {
    const tree = [proj('/p/app', [{
      kind: 'session', sessionId: 's1', title: 'Fix CSV export', cwd: '/p/app',
      gitBranch: null, lastActiveAtMs: 1, messageCount: null, isLive: false, cwdExists: true, note: null,
    }])]
    expect(filterTreeLocal(tree, 'csv', new Set()).tree[0].sessions).toHaveLength(1)
  })

  it('keeps a whole project when the project label matches', () => {
    const tree = [proj('/p/app', [
      { kind: 'session', sessionId: 's1', title: 'Fix CSV export', cwd: '/p/app', gitBranch: null, lastActiveAtMs: 1, messageCount: null, isLive: false, cwdExists: true, note: null },
      { kind: 'session', sessionId: 's2', title: 'Add worktree switcher', cwd: '/p/app', gitBranch: null, lastActiveAtMs: 1, messageCount: null, isLive: false, cwdExists: true, note: null },
    ])]
    expect(filterTreeLocal(tree, 'app', new Set()).tree[0].sessions).toHaveLength(2)
  })

  it('keeps a worktree when its branch matches, retaining the parent', () => {
    const wt: ProjectNode = {
      kind: 'project', path: '/p/wt', label: 'wt', branch: 'species-list', isWorktree: true,
      children: [], sessions: [{
        kind: 'session', sessionId: 's3', title: 'Bump deps', cwd: '/p/wt', gitBranch: null,
        lastActiveAtMs: 1, messageCount: null, isLive: false, cwdExists: true, note: null,
      }],
    }
    const repo: ProjectNode = { ...proj('/p/repo'), children: [wt] }
    const { tree: out } = filterTreeLocal([repo], 'species', new Set())
    expect(out[0].path).toBe('/p/repo')
    const child = out[0].children[0] as ProjectNode
    expect(child.sessions.map((s) => s.sessionId)).toEqual(['s3'])
  })

  it('returns the whole tree for an empty query', () => {
    const tree = [proj('/p/app')]
    expect(filterTreeLocal(tree, '', new Set()).tree).toEqual(tree)
  })

  it('returns nothing when nothing matches', () => {
    const tree = [proj('/p/app', [{
      kind: 'session', sessionId: 's1', title: 'Fix CSV export', cwd: '/p/app',
      gitBranch: null, lastActiveAtMs: 1, messageCount: null, isLive: false, cwdExists: true, note: null,
    }])]
    expect(filterTreeLocal(tree, 'zzzz', new Set()).tree).toHaveLength(0)
  })

  it('keeps a session matched only by content, not title', () => {
    const tree = [proj('/p/app', [{
      kind: 'session', sessionId: 's1', title: 'Bump deps', cwd: '/p/app',
      gitBranch: null, lastActiveAtMs: 1, messageCount: null, isLive: false, cwdExists: true, note: null,
    }])]
    expect(filterTreeLocal(tree, 'csv', new Set(['s1'])).tree[0].sessions).toHaveLength(1)
  })

  it('does not cap — every match is returned, uncapped, for the caller to rank before capping', () => {
    // Capping here (as this function used to) would keep whichever matches a folder walk reaches
    // first rather than the best ones; that job now belongs to the caller, after ranking. See
    // `tests/unit/sessionRank.test.ts`'s "search pipeline" tests for the ranked-then-capped case.
    const sessions = Array.from({ length: 250 }, (_, i) => ({
      kind: 'session' as const, sessionId: `s${i}`, title: `Fix CSV ${i}`, cwd: '/p/app',
      gitBranch: null, lastActiveAtMs: 250 - i, messageCount: null, isLive: false, cwdExists: true, note: null,
    }))
    const { tree, totalMatches } = filterTreeLocal([proj('/p/app', sessions)], 'csv', new Set())
    expect(totalMatches).toBe(250)
    expect(tree[0].sessions).toHaveLength(250)
  })
})
