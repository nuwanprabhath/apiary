import { describe, expect, it, vi } from 'vitest'

const set = vi.fn()
vi.mock('electron', () => ({
  app: { getSystemLocale: () => 'en-US', getLocale: () => 'en-US' },
  session: { defaultSession: { availableSpellCheckerLanguages: ['en-US', 'de'], setSpellCheckerLanguages: (l: string[]) => { set(l) } } },
}))

const { SpellingService } = await import('../../src/main/spelling/spellingService')

function gate(allowed: boolean) {
  const listeners = new Set<() => void>()
  const g = {
    allowed,
    allows: () => g.allowed,
    onChange: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    set: (v: boolean) => { g.allowed = v; for (const fn of listeners) fn() },
  }
  return g
}

describe('spellcheck dictionaries and Settings → Privacy', () => {
  it('on Linux sets no language until allowed, and applies it on a grant', () => {
    set.mockClear()
    const g = gate(false)
    new SpellingService({ privacyGate: g, platform: 'linux' }).restore('en-US')
    expect(set).toHaveBeenLastCalledWith([])
    g.set(true)
    expect(set).toHaveBeenLastCalledWith(['en-US'])
    g.set(false)
    expect(set).toHaveBeenLastCalledWith([])
  })

  it('on macOS the system checker is never held', () => {
    set.mockClear()
    new SpellingService({ privacyGate: gate(false), platform: 'darwin' }).restore('en-US')
    expect(set).toHaveBeenLastCalledWith(['en-US'])
  })

  it('counts a gate that throws as not allowed', () => {
    set.mockClear()
    new SpellingService({ privacyGate: { allows: () => { throw new Error('boom') }, onChange: () => () => {} }, platform: 'linux' }).restore('en-US')
    expect(set).toHaveBeenLastCalledWith([])
  })
})
