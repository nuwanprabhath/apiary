import type { AccountId } from '@shared/domain/ids'
import type { Limits } from './limits'

/**
 * The limits the Claude usage plugin last fetched, by account, for code that must not fetch them
 * itself (the residents' digest pause). Only what the plugin already has: nothing here reads a
 * token, so without the user's consent it simply stays empty.
 */
export class UsageFeed {
  /** Invalidated by the plugin's next poll of that account, which records over it. */
  private readonly latest = new Map<AccountId, Limits | undefined>()

  record(account: AccountId, limits: Limits | undefined): void { this.latest.set(account, limits) }

  /** The 5-hour window's use in percent, or null when the plugin has not fetched it. */
  fiveHourPercent(account: AccountId): number | null {
    return this.latest.get(account)?.fiveHour?.utilization ?? null
  }
}
