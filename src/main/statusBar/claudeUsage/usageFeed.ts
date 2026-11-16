import type { AccountId } from '@shared/domain/ids'
import type { Limits } from './limits'

/** A window used this far is the one holding the account back. */
const LIMIT_REACHED_PERCENT = 98

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

  /**
   * When the account can send again: the reset of the window that is used up (at or near 100%), the
   * later one when several are; null when none is, or the plugin has not fetched.
   */
  limitResetsAt(account: AccountId): number | null {
    const limits = this.latest.get(account)
    if (limits === undefined) return null
    const resets = [limits.fiveHour, limits.sevenDay, limits.sevenDayOpus]
      .filter((w) => w !== undefined && w.utilization >= LIMIT_REACHED_PERCENT && w.resetsAt !== undefined)
      .map((w) => Date.parse(w?.resetsAt ?? ''))
      .filter((t) => Number.isFinite(t))
    return resets.length === 0 ? null : Math.max(...resets)
  }
}
