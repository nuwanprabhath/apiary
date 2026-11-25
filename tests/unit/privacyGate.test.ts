import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/main/settings'
import { createPrivacyGate, type PrivacySettings } from '../../src/main/privacy/privacyGate'

function fakeSettings(initial: Partial<AppSettings> = {}): PrivacySettings & { current: AppSettings } {
  const listeners = new Set<(next: AppSettings, prev: AppSettings) => void>()
  const s = {
    current: { ...DEFAULT_SETTINGS, ...initial },
    get: () => s.current,
    patch: (p: Partial<AppSettings>) => {
      const prev = s.current
      s.current = { ...prev, ...p }
      for (const fn of listeners) fn(s.current, prev)
    },
    onChange: (fn: (next: AppSettings, prev: AppSettings) => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
  }
  return s
}

describe('PrivacyGate', () => {
  it('grant and revoke write the consents to settings', async () => {
    const settings = fakeSettings()
    const gate = createPrivacyGate(settings, () => 123)
    expect(gate.allows('slackBridge')).toBe(false)
    await gate.grant('slackBridge')
    expect(settings.current.privacyConsents).toEqual({ slackBridge: { grantedAt: 123, source: 'user' } })
    expect(gate.allows('slackBridge')).toBe(true)
    await gate.grant('residentCycles', 'migrated')
    expect(settings.current.privacyConsents.residentCycles?.source).toBe('migrated')
    await gate.revoke('slackBridge')
    expect(settings.current.privacyConsents).toEqual({ residentCycles: { grantedAt: 123, source: 'migrated' } })
    expect(gate.allows('slackBridge')).toBe(false)
  })

  it('onChange fires for strict mode and consents, and for nothing else', async () => {
    const settings = fakeSettings()
    const gate = createPrivacyGate(settings)
    let fired = 0
    const off = gate.onChange(() => { fired++ })
    settings.patch({ diagnosticsEnabled: true })
    settings.patch({ dataRetentionDays: 60 })
    expect(fired).toBe(0)
    await gate.grant('gitlabLookups')
    expect(fired).toBe(1)
    settings.patch({ gdprStrictMode: false })
    expect(fired).toBe(2)
    off()
    settings.patch({ gdprStrictMode: true })
    expect(fired).toBe(2)
  })

  it('strict mode off allows every feature', () => {
    const gate = createPrivacyGate(fakeSettings({ gdprStrictMode: false }))
    expect(gate.strict()).toBe(false)
    expect(gate.allows('backgroundDigest')).toBe(true)
    expect(gate.allows('spellDictionaries')).toBe(true)
  })

  it('holds a feature when the settings cannot be read', () => {
    const settings = fakeSettings({ gdprStrictMode: false })
    const gate = createPrivacyGate({ ...settings, get: () => { throw new Error('unreadable') } })
    expect(gate.allows('backgroundDigest')).toBe(false)
  })
})
