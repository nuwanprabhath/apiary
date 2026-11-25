import { cleanPrivacyConsents, privacyAllows, type PrivacyConsents, type PrivacyFeature } from '@shared/domain/privacy'
import { errorMessage } from '@shared/errors'
import { log } from '../log/logger'
import type { AppSettings } from '../settings'

/** The part of `SettingsService` the gate reads and writes. */
export interface PrivacySettings {
  get(): Readonly<AppSettings>
  patch(p: Partial<AppSettings>): void
  onChange(fn: (next: AppSettings, prev: AppSettings) => void): () => void
}

/** Whether an automatic processing may run now; every background feature asks before it sends. */
export interface PrivacyGate {
  allows(feature: PrivacyFeature): boolean
  /** Fires when `gdprStrictMode` or `privacyConsents` changed, and for no other setting. */
  onChange(listener: () => void): () => void
  grant(feature: PrivacyFeature, source?: 'user' | 'migrated'): Promise<void>
  revoke(feature: PrivacyFeature): Promise<void>
  strict(): boolean
}

const sameConsents = (a: PrivacyConsents, b: PrivacyConsents): boolean => JSON.stringify(a) === JSON.stringify(b)

export function createPrivacyGate(settings: PrivacySettings, now: () => number = Date.now): PrivacyGate {
  const consents = (): PrivacyConsents => cleanPrivacyConsents(settings.get().privacyConsents)
  return {
    allows: (feature) => {
      try {
        const s = settings.get()
        return privacyAllows(s.gdprStrictMode, cleanPrivacyConsents(s.privacyConsents), feature)
      } catch (e) {
        log.warn('privacy', 'settings unreadable, holding the feature', { feature, error: errorMessage(e) })
        return false
      }
    },
    onChange: (listener) => settings.onChange((next, prev) => {
      if (next.gdprStrictMode !== prev.gdprStrictMode || !sameConsents(cleanPrivacyConsents(next.privacyConsents), cleanPrivacyConsents(prev.privacyConsents))) listener()
    }),
    grant: async (feature, source = 'user') => {
      settings.patch({ privacyConsents: { ...consents(), [feature]: { grantedAt: now(), source } } })
    },
    revoke: async (feature) => {
      const rest = { ...consents() }
      delete rest[feature]
      settings.patch({ privacyConsents: rest })
    },
    strict: () => settings.get().gdprStrictMode,
  }
}
