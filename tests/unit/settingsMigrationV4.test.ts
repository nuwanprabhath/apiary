import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, migrateSettings, migrateToV4, SETTINGS_VERSION, type AppSettings } from '../../src/main/settings'

const NOW = 1_800_000_000_000
const resident = (kind: string, enabled: boolean): unknown => ({ id: `${kind}-1`, kind, enabled })
/** Residents' cases switch the GitLab plugin off, so only what they say is migrated. */
const GITLAB_OFF = { 'gitlab-mr': false }
const v3 = (extra: Record<string, unknown>): Partial<AppSettings> => ({ schemaVersion: 3, ...extra })

describe('settings v4: strict privacy mode', () => {
  it('a fresh install is strict with no consents', () => {
    expect(SETTINGS_VERSION).toBe(4)
    expect(DEFAULT_SETTINGS.gdprStrictMode).toBe(true)
    expect(DEFAULT_SETTINGS.privacyConsents).toEqual({})
  })

  it('a v3 file with nothing switched on becomes strict, keeping only the GitLab plugin it had by default', () => {
    const out = migrateSettings(v3({}), NOW)
    expect(out).toMatchObject({ gdprStrictMode: true, schemaVersion: 4 })
    expect(out.privacyConsents).toEqual({ gitlabLookups: { source: 'migrated', grantedAt: NOW } })
  })

  it('an enabled Regent keeps its digest and cycles, as migrated consents', () => {
    const out = migrateToV4(v3({ plugins: GITLAB_OFF, residents: [resident('regent', true)] }), NOW)
    expect(out.privacyConsents).toEqual({
      backgroundDigest: { source: 'migrated', grantedAt: NOW },
      residentCycles: { source: 'migrated', grantedAt: NOW },
    })
  })

  it('a disabled Regent is given nothing', () => {
    expect(migrateToV4(v3({ plugins: GITLAB_OFF, residents: [resident('regent', false)] }), NOW).privacyConsents).toEqual({})
  })

  it('an enabled MR desk keeps only its cycles', () => {
    expect(migrateToV4(v3({ plugins: GITLAB_OFF, residents: [resident('mr-desk', true)] }), NOW).privacyConsents).toEqual({
      residentCycles: { source: 'migrated', grantedAt: NOW },
    })
  })

  it('the GitLab plugin, on by default, keeps its lookups unless it was switched off', () => {
    const kept = { gitlabLookups: { source: 'migrated', grantedAt: NOW } }
    expect(migrateToV4(v3({ plugins: { 'gitlab-mr': true } }), NOW).privacyConsents).toEqual(kept)
    expect(migrateToV4(v3({ plugins: {} }), NOW).privacyConsents).toEqual(kept)
    expect(migrateToV4(v3({}), NOW).privacyConsents).toEqual(kept)
    expect(migrateToV4(v3({ plugins: { 'gitlab-mr': false } }), NOW).privacyConsents).toEqual({})
  })

  it('never overwrites an existing consent or a chosen strict mode', () => {
    const mine = { grantedAt: 42, source: 'user' }
    const out = migrateToV4(v3({ gdprStrictMode: false, residents: [resident('regent', true)], privacyConsents: { backgroundDigest: mine } }), NOW)
    expect(out.gdprStrictMode).toBe(false)
    expect(out.privacyConsents?.backgroundDigest).toEqual(mine)
    expect(out.privacyConsents?.residentCycles).toEqual({ source: 'migrated', grantedAt: NOW })
  })

  it('a v4 file is left alone', () => {
    const raw = { schemaVersion: 4, gdprStrictMode: false } as Partial<AppSettings>
    expect(migrateSettings(raw, NOW)).toBe(raw)
  })
})
