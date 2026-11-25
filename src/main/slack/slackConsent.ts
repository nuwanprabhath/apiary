import { errorMessage } from '@shared/errors'
import { log } from '../log/logger'
import type { SlackStore } from './slackStore'

/** The part of the privacy gate the one-time carry-over needs. */
export interface ConsentGrantor {
  strict(): boolean
  allows(feature: 'slackBridge'): boolean
  grant(feature: 'slackBridge', source: 'migrated'): Promise<void>
}

/**
 * A Slack that was already on when Settings → Privacy arrived keeps polling: its consent is recorded
 * once (`slackConsentMigrated` in slack.json), so a later revoke is never undone by the next start.
 */
export function migrateSlackConsent(store: SlackStore, gate: ConsentGrantor | undefined): void {
  if (gate === undefined || !store.state.enabled || store.state.slackConsentMigrated) return
  if (gate.strict() && gate.allows('slackBridge')) return
  store.update({ slackConsentMigrated: true })
  gate.grant('slackBridge', 'migrated').catch((e: unknown) => { log.warn('slack', 'could not record the migrated consent', { error: errorMessage(e) }) })
}
