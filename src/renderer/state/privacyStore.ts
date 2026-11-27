import { PRIVACY_DISCLOSURES, type PrivacyFeature, type PrivacyStatus, type PurgeRequest, type PurgeResult } from '@shared/domain/privacy'
import { createIpcStore } from './createIpcStore'
import { surface } from './policy'

/**
 * Strict mode, the per-feature consents and the retention (`main/app/privacyContainer.ts`), pushed
 * whole as `privacyChanged`. Until the first answer strict mode reads as on and nothing as allowed,
 * the answer a fresh install gets.
 */
const privacyStore = createIpcStore<PrivacyStatus>({
  scope: 'privacy',
  initial: { strict: true, consents: {}, disclosures: PRIVACY_DISCLOSURES, retentionDays: 30, usageConsent: 'unasked', held: [] },
  fetch: () => window.apiary.privacyStatus(),
  subscribe: (push) => window.apiary.onPrivacyChanged(push),
})

export function usePrivacy(): PrivacyStatus {
  return privacyStore.useStore()
}

/** Policy 2: the person asked for it, so a refusal is a toast. The new state arrives as `privacyChanged`. */
export function grantPrivacy(feature: PrivacyFeature): void {
  surface(window.apiary.privacyGrant(feature), 'Could not save your choice')
}

export function revokePrivacy(feature: PrivacyFeature, alsoPurge: boolean): void {
  surface(window.apiary.privacyRevoke(feature, alsoPurge), 'Could not withdraw your consent')
}

export function setStrictMode(strict: boolean): void {
  surface(window.apiary.privacySetStrict(strict), 'Could not change privacy mode')
}

/** Policy 3: the purge dialog shows the result or the failure itself. */
export function purgePrivacyData(request: PurgeRequest): Promise<PurgeResult> {
  return window.apiary.privacyPurge(request)
}

/** The folder written, or null when the person cancelled. */
export function exportPrivacyData(): Promise<string | null> {
  return window.apiary.privacyExport()
}
