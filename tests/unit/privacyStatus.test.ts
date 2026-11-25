import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/main/settings'
import { createPrivacy } from '../../src/main/app/privacyContainer'
import { memoryConsentStorage } from '../../src/main/statusBar/claudeUsage/consent'

const settingsOf = (s: Partial<AppSettings>) => {
  let current: AppSettings = { ...DEFAULT_SETTINGS, ...s }
  return { get: () => current, patch: (p: Partial<AppSettings>) => { current = { ...current, ...p } }, onChange: () => () => undefined }
}

describe('privacy status', () => {
  it('reports strict mode, the consents, the retention and the usage meter answer without changing it', async () => {
    const usage = memoryConsentStorage('declined')
    const { service } = createPrivacy({ settings: settingsOf({ dataRetentionDays: 90 }), usageConsent: usage })
    expect(await service.status()).toMatchObject({ strict: true, consents: {}, retentionDays: 90, usageConsent: 'denied' })
    usage.save('granted')
    expect((await service.status()).usageConsent).toBe('allowed')
    expect((await createPrivacy({ settings: settingsOf({}), usageConsent: memoryConsentStorage() }).service.status()).usageConsent).toBe('unasked')
  })

  it('setStrict writes strict mode and keeps the consents', async () => {
    const consents = { slackBridge: { grantedAt: 1, source: 'user' as const } }
    const privacy = createPrivacy({ settings: settingsOf({ privacyConsents: consents }), usageConsent: memoryConsentStorage() })
    privacy.setStrict(false)
    expect(await privacy.service.status()).toMatchObject({ strict: false, consents })
  })

  it('purge and export refuse until their workers are attached, then delegate to them', async () => {
    const privacy = createPrivacy({ settings: settingsOf({}), usageConsent: memoryConsentStorage() })
    await expect(privacy.service.export()).rejects.toThrow('not ready')
    let started = 0
    privacy.attach({
      purge: async () => ({ removedBytes: 7, failed: [] }),
      export: async () => '/picked/apiary-export',
      sweeper: { start: () => { started += 1 }, stop: () => undefined, runOnce: async () => { throw new Error('unused') } },
    })
    await expect(privacy.service.export()).resolves.toBe('/picked/apiary-export')
    await expect(privacy.service.purge({
      searchIndex: true, digests: false, logs: false, residentHistory: false,
      slackMessages: false, pastedImages: false, scheduledLogs: false, sessionMetadata: false,
    })).resolves.toEqual({ removedBytes: 7, failed: [] })
    privacy.startSweeper()()
    expect(started).toBe(1)
  })
})
