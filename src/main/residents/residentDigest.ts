import type { ResidentConfig } from '@shared/domain/residents'
import type { DigestJob } from '../knowledge/types'

/**
 * Drives the background digest for the residents: it runs while one enabled resident of a
 * digesting kind is on duty and privacy allows it, with that resident's model and lookback.
 * A no-op when no digester is wired in.
 */
export class ResidentDigest {
  /** The model and lookback the running pass was resumed with; null while paused. Invalidated by `reset`. */
  private key: string | null = null
  private activityText: string | null = null

  /** `allowed`: Settings → Privacy lets the background digest run. */
  constructor(private readonly job: DigestJob | null, private readonly allowed: () => boolean) {}

  /** A few words on what the digest is doing, or null when idle. */
  get activity(): string | null { return this.activityText }

  /** Follows the digester's activity; returns how to stop. */
  listen(changed: () => void): (() => void) | null {
    if (this.job === null) return null
    return this.job.onActivity((activity) => {
      this.activityText = activity
      changed()
    })
  }

  /**
   * Resumes the digest for `driver` (the first on-duty digesting resident) when privacy allows, or
   * pauses it. Returns true when it paused, so the caller can report the change.
   */
  reconcile(driver: ResidentConfig | undefined, overUsage: () => boolean): boolean {
    if (this.job === null) return false
    const key = driver === undefined || !this.allowed() ? null : `${driver.digestModel}\n${JSON.stringify(driver.digestLookback)}`
    if (key === this.key) return false
    this.key = key
    if (key === null || driver === undefined) {
      this.job.pause()
      return true
    }
    this.job.resume({ model: driver.digestModel, lookback: driver.digestLookback, shouldPause: () => overUsage() || !this.allowed() })
    return false
  }

  /** Forgets every digest; the next `reconcile` starts a new pass. False when there is no digester. */
  async reset(): Promise<boolean> {
    if (this.job === null) return false
    await this.job.reset()
    this.key = null
    return true
  }

  pause(): void { this.job?.pause() }
}
