import { describe, it, expect } from 'vitest'
import { rankSessions } from '../../src/shared/sessionRank'
import { filterTreeLocal, SEARCH_RESULT_CAP } from '../../src/shared/treeFilter'
import type { ProjectNode, SessionNode } from '../../src/shared/types'

const session = (over: Partial<SessionNode>): SessionNode => ({
  kind: 'session', sessionId: over.sessionId ?? 's', title: 'untitled', cwd: '/p',
  gitBranch: null, lastActiveAtMs: 0, messageCount: null, isLive: false, cwdExists: true,
  note: null, ...over,
})

const project = (sessions: SessionNode[], over: Partial<ProjectNode> = {}): ProjectNode => ({
  kind: 'project', path: '/p', label: 'repo', branch: 'main', isWorktree: false,
  children: [], sessions, ...over,
})

describe('rankSessions', () => {
  it('ranks an exact title match above a mere prefix, which ranks above a subsequence', () => {
    const tree = [project([
      session({ sessionId: 'sub', title: 'refactor csv export logic' }),
      session({ sessionId: 'prefix', title: 'csv something else' }),
      session({ sessionId: 'exact', title: 'csv' }),
    ])]
    const ranked = rankSessions(tree, 'csv', new Set())
    expect(ranked.map((r) => r.session.sessionId)).toEqual(['exact', 'prefix', 'sub'])
  })

  it('ranks a path/branch match below a title match but above a content-only match', () => {
    const tree = [project(
      [
        session({ sessionId: 'content-only', title: 'unrelated' }),
        session({ sessionId: 'by-path', title: 'also unrelated', cwd: '/p/csv-tool' }),
      ],
      { path: '/p/csv-tool' },
    )]
    const ranked = rankSessions(tree, 'csv', new Set(['content-only']))
    expect(ranked.map((r) => r.session.sessionId)).toEqual(['by-path', 'content-only'])
  })

  it('breaks ties within a tier by lastActiveAtMs descending', () => {
    const tree = [project([
      session({ sessionId: 'older', title: 'csv one', lastActiveAtMs: 1 }),
      session({ sessionId: 'newer', title: 'csv two', lastActiveAtMs: 2 }),
    ])]
    expect(rankSessions(tree, 'csv', new Set()).map((r) => r.session.sessionId))
      .toEqual(['newer', 'older'])
  })

  it('carries the session’s worktree label for the subtitle', () => {
    const tree = [project([session({ title: 'csv' })], { label: 'my-worktree' })]
    expect(rankSessions(tree, 'csv', new Set())[0].worktreeLabel).toBe('my-worktree')
  })
})

/**
 * The full search pipeline: `filterTreeLocal` (uncapped) -> `rankSessions` -> the caller's own
 * cap. Exercised together because the bug this guards against lives in the seam between the two
 * functions, not inside either one alone: capping *before* ranking (what `filterTreeLocal` used to
 * do) keeps whichever matches a folder walk reaches first, discarding better matches that come
 * later — an exact title match in project two-hundred loses to weak subsequence matches in the
 * first forty-nine. Capping *after* ranking (what the pipeline does now) keeps the best matches
 * regardless of where in the tree they live.
 */
describe('the search pipeline (filterTreeLocal -> rankSessions -> cap)', () => {
  it('surfaces the best match at the top even when it is buried past the cap in tree order', () => {
    // 251 matches, one project, `SEARCH_RESULT_CAP` is 200: the exact title match is the very last
    // session in the array, so a cap applied before ranking (in tree-walk order) would drop it
    // entirely, and this assertion would see some decoy in its place — which is exactly what
    // failed before this fix, since `filterTreeLocal` used to cap first.
    const decoys = Array.from({ length: 250 }, (_, i) => session({
      sessionId: `decoy-${i}`, title: `unrelated csv thing ${i}`, lastActiveAtMs: 250 - i,
    }))
    const best = session({ sessionId: 'best', title: 'csv', lastActiveAtMs: 0 })
    const tree = [project([...decoys, best])]

    const { tree: filtered, totalMatches } = filterTreeLocal(tree, 'csv', new Set())
    expect(totalMatches).toBe(251)

    const ranked = rankSessions(filtered, 'csv', new Set()).slice(0, SEARCH_RESULT_CAP)
    expect(ranked).toHaveLength(SEARCH_RESULT_CAP)
    expect(ranked[0].session.sessionId).toBe('best')
  })
})
