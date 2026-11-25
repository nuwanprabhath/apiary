/**
 * Privacy in the fake, modelled on `createPrivacy` (src/main/app/privacyContainer.ts): strict mode,
 * the consents and the retention live in the settings, a grant, a revoke or a strict change tells
 * every window with `privacyChanged`, and the usage meter's answer is reported, never changed.
 * Purge and export answer as main will once they exist. `tests/contract/clauses/privacy.ts` pins it.
 */
import type { ApiaryApi } from '@shared/api'
import { cleanPrivacyConsents, PRIVACY_DISCLOSURES, type PrivacyStatus } from '@shared/domain/privacy'
import type { Env } from './state'

type PrivacyApiFake = Pick<ApiaryApi, 'privacyStatus' | 'privacyGrant' | 'privacyRevoke' | 'privacySetStrict' | 'privacyPurge' | 'privacyExport'>

export function privacyApi(env: Env): PrivacyApiFake {
  const { state, emit } = env
  const status = (): PrivacyStatus => ({
    strict: state.settings.gdprStrictMode,
    consents: cleanPrivacyConsents(state.settings.privacyConsents),
    disclosures: PRIVACY_DISCLOSURES,
    retentionDays: state.settings.dataRetentionDays,
    usageConsent: state.usageConsent,
  })
  const changed = (): void => { emit('privacyChanged', status()) }
  return {
    privacyStatus: async () => status(),
    privacyGrant: async (feature) => {
      state.settings = { ...state.settings, privacyConsents: { ...state.settings.privacyConsents, [feature]: { grantedAt: Date.now(), source: 'user' } } }
      changed()
    },
    privacyRevoke: async (feature) => {
      const rest = { ...state.settings.privacyConsents }
      delete rest[feature]
      state.settings = { ...state.settings, privacyConsents: rest }
      changed()
    },
    privacySetStrict: async (strict) => {
      state.settings = { ...state.settings, gdprStrictMode: strict }
      changed()
    },
    privacyPurge: async () => ({ removedBytes: 0, failed: [] }),
    privacyExport: async () => null,
  }
}
