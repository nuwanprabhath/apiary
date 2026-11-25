import { describe, expect, it } from 'vitest'
import {
  cleanPrivacyConsents, isPrivacyConsents, isPrivacyFeature, isPurgeRequest, PRIVACY_DISCLOSURES, PRIVACY_FEATURES, privacyAllows, purgeFor,
} from '@shared/domain/privacy'

const NOTHING = {
  searchIndex: false, digests: false, logs: false, residentHistory: false,
  slackMessages: false, pastedImages: false, scheduledLogs: false, sessionMetadata: false,
}
const GRANT = { grantedAt: 1_700_000_000_000, source: 'user' as const }

describe('privacyAllows', () => {
  it.each([
    [false, {}, true],
    [false, { backgroundDigest: GRANT }, true],
    [true, {}, false],
    [true, { backgroundDigest: GRANT }, true],
    [true, { slackBridge: GRANT }, false],
  ])('strict %s with %j allows backgroundDigest: %s', (strict, consents, allowed) => {
    expect(privacyAllows(strict, consents, 'backgroundDigest')).toBe(allowed)
  })
})

describe('consents', () => {
  it('keeps the record whole and drops unknown keys and malformed entries', () => {
    const raw = {
      backgroundDigest: GRANT,
      telemetry: GRANT,
      slackBridge: { grantedAt: -1, source: 'user' },
      gitlabLookups: { grantedAt: 5, source: 'someone' },
      residentCycles: { grantedAt: 9, source: 'migrated' },
    }
    expect(isPrivacyConsents(raw)).toBe(true)
    expect(cleanPrivacyConsents(raw)).toEqual({ backgroundDigest: GRANT, residentCycles: { grantedAt: 9, source: 'migrated' } })
    expect(isPrivacyConsents([])).toBe(false)
    expect(cleanPrivacyConsents('x')).toEqual({})
  })

  it('knows the five features, each with a plain disclosure', () => {
    expect(PRIVACY_FEATURES.every(isPrivacyFeature)).toBe(true)
    expect(isPrivacyFeature('telemetry')).toBe(false)
    for (const f of PRIVACY_FEATURES) expect(PRIVACY_DISCLOSURES[f].sends.length).toBeGreaterThan(20)
    expect(PRIVACY_DISCLOSURES.backgroundDigest.recipient).toBe('Anthropic')
  })
})

describe('PurgeRequest', () => {
  it('accepts every item as a boolean and nothing else', () => {
    expect(isPurgeRequest(NOTHING)).toBe(true)
    expect(isPurgeRequest({ ...NOTHING, extra: true })).toBe(false)
    expect(isPurgeRequest({ ...NOTHING, logs: 'yes' })).toBe(false)
    const { logs: _logs, ...missing } = NOTHING
    expect(isPurgeRequest(missing)).toBe(false)
  })

  it('withdrawing a feature offers to delete only what it produced', () => {
    expect(purgeFor('backgroundDigest')).toEqual({ ...NOTHING, digests: true })
    expect(purgeFor('slackBridge')).toEqual({ ...NOTHING, slackMessages: true })
    expect(purgeFor('gitlabLookups')).toBeNull()
  })
})
