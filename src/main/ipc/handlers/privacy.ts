import { purgeFor } from '@shared/domain/privacy'
import type { PrivacyGate } from '../../privacy/privacyGate'
import type { PrivacyService } from '../../privacy/types'
import type { Handlers } from '../registrar'

type HandledKeys = 'privacyStatus' | 'privacyGrant' | 'privacyRevoke' | 'privacySetStrict' | 'privacyPurge' | 'privacyExport'

export interface PrivacyIpc {
  gate: PrivacyGate
  service: PrivacyService
  /** Writes `gdprStrictMode`; the gate's `onChange` then tells every window. */
  setStrict(strict: boolean): void
}

/** The guards checked the feature and the purge request; the gate and the service do the rest. */
export function privacyHandlers(privacy: PrivacyIpc | null): Pick<Handlers, HandledKeys> {
  const p = (): PrivacyIpc => {
    if (privacy === null) throw new Error('Privacy controls are not available here.')
    return privacy
  }
  return {
    privacyStatus: () => p().service.status(),
    privacyGrant: (_e, feature) => p().gate.grant(feature),
    privacyRevoke: async (_e, feature, alsoPurge) => {
      await p().gate.revoke(feature)
      const items = alsoPurge ? purgeFor(feature) : null
      if (items !== null) await p().service.purge(items)
    },
    privacySetStrict: (_e, strict) => { p().setStrict(strict) },
    privacyPurge: (_e, req) => p().service.purge(req),
    privacyExport: () => p().service.export(),
  }
}
