import { describe, expect, it, vi } from 'vitest'
import type { PrivacyFeature } from '@shared/domain/privacy'
import { log } from '../../../src/main/log/logger'
import { at } from '../../contract/must'
import { FRIDAY, build, regent } from '../../integration/residents/support'

/** A gate whose consents a test grants and revokes; `fire` is what the privacy gate's onChange does. */
function gate(initial: PrivacyFeature[] = []) {
  const allowed = new Set<PrivacyFeature>(initial)
  const listeners = new Set<() => void>()
  return {
    allows: (f: PrivacyFeature) => allowed.has(f),
    onChange: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    grant: (f: PrivacyFeature) => { allowed.add(f); for (const fn of listeners) fn() },
    revoke: (f: PrivacyFeature) => { allowed.delete(f); for (const fn of listeners) fn() },
  }
}

const cycle = { cycle: { everyMinutes: 1, prompt: 'check the desk', doing: 'Checking' } }

describe('resident privacy gating', () => {
  it('does not start the digest without consent, says why, and resumes on a grant', () => {
    vi.setSystemTime(FRIDAY(12))
    const g = gate()
    const { service, digest } = build([regent()], { privacyGate: g })
    service.start()
    expect(digest.calls.some((c) => c.startsWith('resume'))).toBe(false)
    expect(at(service.list(), 0).digestPaused).toBe('consent')
    g.grant('backgroundDigest')
    expect(digest.calls.some((c) => c.startsWith('resume'))).toBe(true)
    expect(at(service.list(), 0).digestPaused).toBeNull()
  })

  it('stops the running digest when consent is withdrawn', () => {
    vi.setSystemTime(FRIDAY(12))
    const g = gate(['backgroundDigest'])
    const { service, digest } = build([regent()], { privacyGate: g })
    service.start()
    g.revoke('backgroundDigest')
    expect(digest.calls.at(-1)).toBe('pause')
    expect(digest.shouldPause?.()).toBe(true)
  })

  it('reports a usage pause as usage', () => {
    vi.setSystemTime(FRIDAY(12))
    const { service } = build([regent()], { privacyGate: gate(['backgroundDigest']), usage: 90 })
    service.start()
    expect(at(service.list(), 0).digestPaused).toBe('usage')
  })

  it('counts a gate that throws as not allowed', () => {
    vi.setSystemTime(FRIDAY(12))
    const { service, digest } = build([regent()], { privacyGate: { allows: () => { throw new Error('boom') }, onChange: () => () => {} } })
    service.start()
    expect(digest.calls.some((c) => c.startsWith('resume'))).toBe(false)
    expect(at(service.list(), 0).digestPaused).toBe('consent')
  })

  it('skips a scheduled cycle without consent, logs it once, and says it is paused', async () => {
    vi.setSystemTime(FRIDAY(12))
    const info = vi.spyOn(log, 'info').mockImplementation(() => {})
    const { service } = build([regent()], { privacyGate: gate(['backgroundDigest']), kinds: cycle })
    service.start()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(service.history('regent').filter((m) => m.text === 'check the desk')).toHaveLength(0)
    expect(at(service.list(), 0).cycle?.paused).toBe('consent')
    expect(info.mock.calls.filter((c) => c[1] === 'cycle skipped' && JSON.stringify(c[2]).includes('consent'))).toHaveLength(1)
  })

  it('runs the cycle once consent is granted', async () => {
    vi.setSystemTime(FRIDAY(12))
    const g = gate()
    const { service } = build([regent()], { privacyGate: g, kinds: cycle })
    service.start()
    g.grant('residentCycles')
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    await vi.waitFor(() => { expect(service.history('regent').filter((m) => m.text === 'check the desk')).toHaveLength(1) })
  })

  it('still runs "Check now" without consent: a click is direct invocation', async () => {
    vi.setSystemTime(FRIDAY(12))
    const { service } = build([regent()], { privacyGate: gate(), kinds: cycle })
    service.start()
    await service.quickAction('regent', 'cycle')
    expect(service.history('regent').map((m) => m.text)).toContain('check the desk')
  })
})
