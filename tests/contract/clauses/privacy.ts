import { describe, expect, it } from 'vitest'
import { PRIVACY_DISCLOSURES } from '@shared/domain/privacy'
import type { Ctx } from '../support'

const NOTHING = {
  searchIndex: false, digests: false, logs: false, residentHistory: false,
  slackMessages: false, pastedImages: false, scheduledLogs: false, sessionMetadata: false,
}

export function definePrivacyClauses(ctx: Ctx): void {
  describe('privacy', () => {
    it('privacyStatus answers strict mode on by default, no consents and every disclosure', async () => {
      const status = await ctx.api.privacyStatus()
      expect(status).toMatchObject({ strict: true, consents: {}, retentionDays: 30, held: [] })
      expect(status.disclosures).toEqual(PRIVACY_DISCLOSURES)
      expect(['allowed', 'denied', 'unasked']).toContain(status.usageConsent)
    })

    it('a grant then a revoke show in the status, each telling every window', async () => {
      await ctx.api.privacyGrant('backgroundDigest')
      const granted = await ctx.api.privacyStatus()
      expect(granted.consents.backgroundDigest?.source).toBe('user')
      await expect.poll(() => ctx.heard.payloads('privacyChanged').at(-1)?.[0].consents.backgroundDigest?.source).toBe('user')
      await ctx.api.privacyRevoke('backgroundDigest', false)
      expect((await ctx.api.privacyStatus()).consents).toEqual({})
      await expect.poll(() => ctx.heard.payloads('privacyChanged').at(-1)?.[0].consents).toEqual({})
    })

    it('privacySetStrict off keeps the consents and tells every window', async () => {
      await ctx.api.privacyGrant('gitlabLookups')
      await ctx.api.privacySetStrict(false)
      const status = await ctx.api.privacyStatus()
      expect(status.strict).toBe(false)
      expect(status.consents.gitlabLookups).toBeDefined()
      await expect.poll(() => ctx.heard.payloads('privacyChanged').at(-1)?.[0].strict).toBe(false)
    })

    it('refuses an unknown feature and leaves the consents alone', async () => {
      // @ts-expect-error -- an unknown feature, as a stale or hostile renderer could send
      await expect(ctx.api.privacyGrant('telemetry')).rejects.toThrow()
      // @ts-expect-error -- an unknown feature
      await expect(ctx.api.privacyRevoke('telemetry', true)).rejects.toThrow()
      expect((await ctx.api.privacyStatus()).consents).toEqual({})
    })

    it('privacyPurge refuses a request with an extra key or a non-boolean item', async () => {
      // @ts-expect-error -- an item main does not know
      await expect(ctx.api.privacyPurge({ ...NOTHING, claudeTranscripts: true })).rejects.toThrow()
      // @ts-expect-error -- not a boolean
      await expect(ctx.api.privacyPurge({ ...NOTHING, logs: 'yes' })).rejects.toThrow()
    })

    it('privacyExport refuses an argument: the renderer never names where it goes', async () => {
      // @ts-expect-error -- a path from the renderer
      await expect(ctx.api.privacyExport('/tmp/out')).rejects.toThrow()
    })
  })
}
