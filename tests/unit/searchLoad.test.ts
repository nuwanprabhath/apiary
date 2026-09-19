import { describe, it, expect } from 'vitest'
import { filterTreeLocal, SEARCH_RESULT_CAP } from '../../src/shared/treeFilter'
import { rankSessions } from '../../src/shared/sessionRank'
import type { ProjectNode, SessionNode } from '../../src/shared/types'

/**
 * 5,000 sessions across 200 synthetic projects — the shape the spec's load test asks for. Built
 * once per test so the fixture cost itself doesn't leak into the measured budget.
 */
function buildSyntheticTree(): ProjectNode[] {
  const projects: ProjectNode[] = []
  let remaining = 5000
  for (let p = 0; p < 200 && remaining > 0; p++) {
    const sessions: SessionNode[] = []
    const perProject = Math.ceil(5000 / 200)
    for (let s = 0; s < perProject && remaining > 0; s++, remaining--) {
      sessions.push({
        kind: 'session',
        sessionId: `p${p}-s${s}`,
        // Every 37th session mentions "csv" so a 3-character query has a small, known hit set.
        title: s % 37 === 0 ? `Fix CSV export bug ${p}-${s}` : `Session ${p}-${s} routine work`,
        cwd: `/synthetic/project-${p}`,
        gitBranch: 'main',
        lastActiveAtMs: Date.now() - s * 1000,
        messageCount: 10,
        isLive: false,
        cwdExists: true,
        note: null,
      })
    }
    projects.push({
      kind: 'project', path: `/synthetic/project-${p}`, label: `project-${p}`,
      branch: 'main', isWorktree: false, children: [], sessions,
    })
  }
  return projects
}

describe('local search performance', () => {
  it('filters 5,000 sessions across 200 projects within budget', () => {
    const tree = buildSyntheticTree()
    const started = performance.now()
    const { tree: filtered } = filterTreeLocal(tree, 'csv', new Set())
    const elapsedMs = performance.now() - started

    expect(filtered.length).toBeGreaterThan(0)
    // The budget the spec asks for: a 3-character query must stay well inside what anyone would
    // perceive as lag. This machine class measures single-digit milliseconds; 40ms leaves real
    // headroom while still catching an accidental O(n^2) walk introduced later.
    expect(elapsedMs).toBeLessThan(40)
  })

  it('keeps the keystroke-to-paint work under 50ms', () => {
    // There is no jsdom/React-testing-library in this repo's unit-test stack (vitest runs plain
    // Node — see vitest.config.ts's `environment: 'node'`), so an actual paint cannot be measured
    // here; what is measured instead is the raw cost of the call `useTree` memoizes on
    // `[rawTree, debouncedQuery, matchedByContent]` (see useTree.ts) — i.e. the work done once
    // per settled query, not per render. An e2e budget on the real DOM belongs in Task 9's
    // `search.spec.ts`, not here.
    const tree = buildSyntheticTree()
    const started = performance.now()
    filterTreeLocal(tree, 'fix', new Set())
    const elapsedMs = performance.now() - started
    expect(elapsedMs).toBeLessThan(50)
  })

  it('ranks-then-caps the full pipeline within budget even when a query matches nearly everything', () => {
    // Ranking now runs over the *whole* uncapped match set (see treeFilter.ts / sessionRank.ts) —
    // the fix for the bug where capping before ranking discarded good matches that came later in
    // tree order. That trade means a broad query (here, a single character every title contains)
    // is the worst case for cost: filtering keeps essentially all 5,000 sessions, and ranking has
    // to sort all of them before the cap ever applies. This is the case that would have caught it
    // quietly getting slow again.
    const tree = buildSyntheticTree()
    const started = performance.now()
    const { tree: filtered, totalMatches } = filterTreeLocal(tree, 's', new Set())
    const ranked = rankSessions(filtered, 's', new Set()).slice(0, SEARCH_RESULT_CAP)
    const elapsedMs = performance.now() - started

    expect(totalMatches).toBeGreaterThan(4900) // confirms this is actually the near-everything case
    expect(ranked).toHaveLength(SEARCH_RESULT_CAP)
    // Generous relative to the 40ms filter-only budget above, because this does strictly more work
    // (a full sort of every match, not just a tree walk) — see the report for what this actually
    // measures on this machine.
    expect(elapsedMs).toBeLessThan(200)
  })
})
