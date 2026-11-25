import { IPC } from '@shared/api'
import { cleanPrivacyConsents, PRIVACY_DISCLOSURES, type UsageConsentAnswer } from '@shared/domain/privacy'
import { fireAndForget } from '../log/fireAndForget'
import { createPrivacyGate, type PrivacyGate, type PrivacySettings } from '../privacy/privacyGate'
import type { PrivacyService } from '../privacy/types'
import { ConsentStore, type ConsentState, type ConsentStorage } from '../statusBar/claudeUsage/consent'
import { broadcast } from '../windows/broadcast'
import type { RetentionSweeper } from '../privacy/retentionSweeper'

export type { ConsentStorage, PrivacyGate }

export interface PrivacyParts {
  gate: PrivacyGate
  service: PrivacyService
  /** Writes `gdprStrictMode`; consents are kept, so turning it back on restores the same set. */
  setStrict: (strict: boolean) => void
  /** Hands over the purge, export and sweeper once the stores they reach exist (`withPrivacyTargets`). */
  attach: (workers: PrivacyWorkers) => void
  /** Starts the retention sweeper; returns its stop. A no-op before `attach`. */
  startSweeper: () => () => void
}

export interface PrivacyWorkers {
  purge: PrivacyService['purge']
  export: PrivacyService['export']
  sweeper: RetentionSweeper
}

const USAGE_ANSWER: Record<ConsentState, UsageConsentAnswer> = { granted: 'allowed', declined: 'denied', unknown: 'unasked' }

/**
 * The privacy gate every background feature asks, and the service the privacy IPC delegates to.
 * The usage meter's consent stays `ConsentStore`'s (ADR-0019): the status only reports it.
 */
export function createPrivacy(deps: {
  settings: PrivacySettings
  /** Where the usage plugin keeps its consent answer; the same storage the plugin is given. */
  usageConsent: ConsentStorage
  now?: () => number
}): PrivacyParts {
  const gate = createPrivacyGate(deps.settings, deps.now)
  const usage = new ConsentStore(deps.usageConsent)
  let workers: PrivacyWorkers | null = null
  const ready = (): PrivacyWorkers => {
    if (workers === null) throw new Error('Privacy tools are not ready yet.')
    return workers
  }
  const service: PrivacyService = {
    status: async () => {
      const s = deps.settings.get()
      return {
        strict: s.gdprStrictMode,
        consents: cleanPrivacyConsents(s.privacyConsents),
        disclosures: PRIVACY_DISCLOSURES,
        retentionDays: s.dataRetentionDays,
        usageConsent: USAGE_ANSWER[usage.state()],
      }
    },
    purge: async (req) => ready().purge(req),
    export: async () => ready().export(),
  }
  return {
    gate, service,
    setStrict: (strict) => { deps.settings.patch({ gdprStrictMode: strict }) },
    attach: (w) => { workers = w },
    startSweeper: () => {
      const sweeper = workers?.sweeper
      sweeper?.start()
      return () => { sweeper?.stop() }
    },
  }
}

/** The app's privacy: over `settings.json`, telling every window when strict mode or a consent changes. */
export function createAppPrivacy(settings: PrivacySettings): { privacy: PrivacyParts; usageConsent: ConsentStorage } {
  const usageConsent: ConsentStorage = {
    load: () => settings.get().claudeUsageConsent,
    save: (state) => { settings.patch({ claudeUsageConsent: state }) },
  }
  const privacy = createPrivacy({ settings, usageConsent })
  privacy.gate.onChange(() => { fireAndForget(privacy.service.status().then((status) => { broadcast(IPC.privacyChanged, status) }), 'privacy') })
  return { privacy, usageConsent }
}
