import { describe, it, expect } from 'vitest'
import { selectRecent, pruneDismissed, dismissRecent } from '../../src/renderer/state/recentSessions'
import type { SessionNode } from '../../src/shared/types'

const HOUR = 3600_000

function session(id: string, lastActiveAtMs: number | null): SessionNode {
  return {
    kind: 'session', sessionId: id, title: id, cwd: '/x', gitBranch: null,
    lastActiveAtMs, messageCount: 1, isLive: false, cwdExists: true, note: null,
  }
}

describe('selectRecent', () => {
  const now = 1_000_000 * HOUR

  it('keeps only sessions active within the window, newest first', () => {
    const sessions = [
      session('old', now - 30 * HOUR),
      session('newer', now - 2 * HOUR),
      session('newest', now - 1 * HOUR),
    ]
    const result = selectRecent(sessions, new Set(), new Set(), {}, now, 24)
    expect(result.map((s) => s.sessionId)).toEqual(['newest', 'newer'])
  })

  it('excludes pinned and active sessions even when they are within the window', () => {
    const sessions = [session('pinned-one', now - 1 * HOUR), session('active-one', now - 1 * HOUR), session('plain', now - 1 * HOUR)]
    const result = selectRecent(sessions, new Set(['pinned-one']), new Set(['active-one']), {}, now, 24)
    expect(result.map((s) => s.sessionId)).toEqual(['plain'])
  })

  it('hides a dismissed session, and brings it back once it is active again', () => {
    const dismissedAt = now - 1 * HOUR
    const sessions = [session('a', now - 3 * HOUR)]
    const dismissed = dismissRecent({}, 'a', dismissedAt)
    // Still active after the dismissal timestamp was set but before real re-use: lastActiveAtMs
    // predates the dismissal, so it stays hidden.
    expect(selectRecent(sessions, new Set(), new Set(), dismissed, now, 24)).toEqual([])

    const reused = [session('a', dismissedAt + 1)]
    expect(selectRecent(reused, new Set(), new Set(), dismissed, now, 24).map((s) => s.sessionId)).toEqual(['a'])
  })

  it('a session exactly at the window boundary is excluded, one millisecond inside it is kept', () => {
    const windowMs = 24 * HOUR
    const atBoundary = [session('edge', now - windowMs - 1)]
    const insideBoundary = [session('inside', now - windowMs)]
    expect(selectRecent(atBoundary, new Set(), new Set(), {}, now, 24)).toEqual([])
    expect(selectRecent(insideBoundary, new Set(), new Set(), {}, now, 24).map((s) => s.sessionId)).toEqual(['inside'])
  })
})

describe('pruneDismissed', () => {
  it('drops entries older than the window and keeps the rest', () => {
    const now = 1_000_000 * HOUR
    const dismissed = { keep: now - 1 * HOUR, drop: now - 200 * HOUR }
    expect(pruneDismissed(dismissed, now, 24)).toEqual({ keep: now - 1 * HOUR })
  })

  it('returns the same reference when nothing needed pruning', () => {
    const now = 1_000_000 * HOUR
    const dismissed = { keep: now - 1 * HOUR }
    expect(pruneDismissed(dismissed, now, 24)).toBe(dismissed)
  })
})
