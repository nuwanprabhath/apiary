import {
  decideCapability, installInstructions,
  type Capability, type CapabilityInput, type InstallInstructions,
} from './capability'
import { shouldOffer } from './versions'

/**
 * The updater's state machine and scheduler.
 *
 * Everything that talks to Electron, the network or the disk is behind `UpdateBackend`, so the
 * rules here — when to check, what to offer, what a "skip" means, what happens when a download
 * fails halfway — are testable in plain Node against a stub. That matters more than usual for this
 * feature: the real thing can only be exercised by publishing a release, so anything not covered
 * by a test here is covered by nothing until it reaches a user.
 */

export type UpdatePhase =
  /** Nothing known yet, or a check found nothing and was not asked for by hand. */
  | 'idle'
  | 'checking'
  /** A newer version exists and is waiting for the user to say yes. */
  | 'available'
  | 'downloading'
  /** `auto`: staged and ready to install on restart. */
  | 'ready'
  /** `assisted`: the installer is on disk and has been handed to the OS. */
  | 'downloaded'
  /** A check the user asked for that found nothing — worth saying so, unlike a silent one. */
  | 'up-to-date'
  | 'error'

export interface UpdateStatus {
  phase: UpdatePhase
  capability: Capability
  currentVersion: string
  /** The version on offer, when there is one. */
  availableVersion: string | null
  releaseNotes: string | null
  releaseUrl: string | null
  /** 0-100 while downloading, null otherwise. */
  progressPercent: number | null
  /** Where the installer was saved, for the assisted flow's "Show in Finder"/"Open" affordance. */
  downloadedPath: string | null
  /**
   * What to do with that file, in the words of the platform it was downloaded on. Null until
   * there is a file — the instruction depends on which one was downloaded (`.deb` or `.dmg`), not
   * only on the platform, so it cannot be decided up front with the capability.
   */
  install: InstallInstructions | null
  error: string | null
  lastCheckedAt: number | null
  skippedVersion: string | null
}

export interface FeedResult {
  version: string
  releaseNotes: string | null
  releaseUrl: string | null
}

export interface UpdateBackend {
  /** Asks the release feed what the newest version is. Returns null when the feed has nothing. */
  check(opts: { allowPrerelease: boolean }): Promise<FeedResult | null>
  /** `auto`: downloads and stages the update, so `install` only has to relaunch. */
  downloadForInstall(onProgress: (percent: number) => void): Promise<void>
  /** `auto`: quits and installs. Does not return. */
  install(): void
  /**
   * `assisted`: downloads the installer for this platform, verifies it against the checksum in
   * the release metadata, and returns where it was saved.
   */
  downloadInstaller(onProgress: (percent: number) => void): Promise<string>
  /**
   * `assisted`: hands the downloaded installer to the OS, or just reveals it in the file manager.
   * Which one is not the backend's choice: a `.deb` cannot be opened by anything on a stock
   * Ubuntu desktop, so `installInstructions` decides and this does as it is told.
   */
  openInstaller(path: string, action: InstallInstructions['action']): Promise<void>
}

export interface UpdateSettings {
  automaticChecks: boolean
  checkIntervalHours: number
  autoDownload: boolean
  allowPrerelease: boolean
  skippedVersion: string | null
}

export interface UpdateServiceOptions {
  currentVersion: string
  capabilityInput: CapabilityInput
  backend: UpdateBackend
  settings: () => UpdateSettings
  /** Persists a settings change the service makes on the user's behalf (skipping a version). */
  saveSettings: (patch: Partial<UpdateSettings>) => void
  onStatus: (status: UpdateStatus) => void
  /** Injected so tests can drive time; defaults to the real timers. */
  timers?: {
    setTimeout: (fn: () => void, ms: number) => NodeJS.Timeout | number
    clearTimeout: (handle: NodeJS.Timeout | number) => void
    now: () => number
  }
}

/**
 * How long after launch the first automatic check happens.
 *
 * Not zero: startup is already scanning sessions, opening the database and spawning the window,
 * and a network round trip in the middle of that competes with the thing the user is waiting for.
 */
export const FIRST_CHECK_DELAY_MS = 30_000

const MIN_INTERVAL_HOURS = 1
const MAX_INTERVAL_HOURS = 24 * 7

export class UpdateService {
  private readonly opts: UpdateServiceOptions
  private readonly timers: NonNullable<UpdateServiceOptions['timers']>
  private readonly capability: Capability
  private timer: NodeJS.Timeout | number | null = null
  private inFlight = false

  private status: UpdateStatus

  constructor(opts: UpdateServiceOptions) {
    this.opts = opts
    this.timers = opts.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => { clearTimeout(handle as NodeJS.Timeout) },
      now: () => Date.now(),
    }
    this.capability = decideCapability(opts.capabilityInput)
    this.status = {
      phase: 'idle',
      capability: this.capability,
      currentVersion: opts.currentVersion,
      availableVersion: null,
      releaseNotes: null,
      releaseUrl: null,
      progressPercent: null,
      downloadedPath: null,
      install: null,
      error: null,
      lastCheckedAt: null,
      skippedVersion: opts.settings().skippedVersion,
    }
  }

  current(): UpdateStatus {
    return this.status
  }

  /** Starts (or restarts) the automatic schedule to match the current settings. */
  start(): void {
    this.stop()
    if (this.capability.kind === 'unsupported') return
    if (!this.opts.settings().automaticChecks) return
    this.timer = this.timers.setTimeout(() => { void this.runScheduled() }, FIRST_CHECK_DELAY_MS)
  }

  stop(): void {
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** Re-reads the settings: called when the user changes them, so a change takes effect at once. */
  settingsChanged(): void {
    this.patch({ skippedVersion: this.opts.settings().skippedVersion })
    this.start()
  }

  private intervalMs(): number {
    const hours = this.opts.settings().checkIntervalHours
    const clamped = Math.min(Math.max(hours, MIN_INTERVAL_HOURS), MAX_INTERVAL_HOURS)
    return clamped * 60 * 60 * 1000
  }

  private async runScheduled(): Promise<void> {
    await this.check({ manual: false })
    // Re-armed from here rather than with an interval, so a slow check cannot stack up behind
    // itself: the next wait starts when this one finishes.
    if (this.opts.settings().automaticChecks && this.capability.kind !== 'unsupported') {
      this.timer = this.timers.setTimeout(() => { void this.runScheduled() }, this.intervalMs())
    }
  }

  /**
   * Asks the feed whether there is anything newer.
   *
   * A manual check reports its outcome either way — that is the whole point of pressing the
   * button. An automatic one stays silent unless it has something to offer, and swallows its
   * errors into the status rather than interrupting: a laptop that woke up on a captive-portal
   * wifi should not produce a dialog about it.
   */
  async check({ manual }: { manual: boolean }): Promise<UpdateStatus> {
    if (this.capability.kind === 'unsupported') {
      if (manual) this.patch({ phase: 'error', error: this.capability.reason })
      return this.status
    }
    if (this.inFlight) return this.status
    this.inFlight = true
    this.patch({ phase: 'checking', error: null })

    try {
      const settings = this.opts.settings()
      const found = await this.opts.backend.check({ allowPrerelease: settings.allowPrerelease })
      const lastCheckedAt = this.timers.now()

      if (found === null || !shouldOffer({
        current: this.status.currentVersion,
        candidate: found.version,
        // A manual check ignores the skip: pressing "Check for Updates" is asking about the
        // version you skipped as much as any other, and having it answer "up to date" when it is
        // not would be a lie.
        skipped: manual ? null : settings.skippedVersion,
        allowPrerelease: settings.allowPrerelease,
      })) {
        this.patch({
          phase: manual ? 'up-to-date' : 'idle',
          availableVersion: null,
          lastCheckedAt,
        })
        return this.status
      }

      this.patch({
        phase: 'available',
        availableVersion: found.version,
        releaseNotes: found.releaseNotes,
        releaseUrl: found.releaseUrl,
        lastCheckedAt,
      })

      if (settings.autoDownload) await this.download()
      return this.status
    } catch (e) {
      this.patch({
        phase: 'error',
        error: e instanceof Error ? e.message : String(e),
        lastCheckedAt: this.timers.now(),
      })
      return this.status
    } finally {
      this.inFlight = false
    }
  }

  /**
   * Fetches the update. What that means depends on the capability: staged for install on restart,
   * or saved to disk and opened for the user to run.
   */
  async download(): Promise<UpdateStatus> {
    if (this.status.availableVersion === null) return this.status
    if (this.status.phase === 'downloading') return this.status
    this.patch({ phase: 'downloading', progressPercent: 0, error: null })

    const onProgress = (percent: number): void => {
      // Only the percentage changes here, and it changes often; sending a whole status object per
      // network chunk is what makes a progress bar cost more than the download.
      this.patch({ progressPercent: Math.max(0, Math.min(100, Math.round(percent))) })
    }

    try {
      if (this.capability.kind === 'auto') {
        await this.opts.backend.downloadForInstall(onProgress)
        this.patch({ phase: 'ready', progressPercent: 100 })
      } else {
        const path = await this.opts.backend.downloadInstaller(onProgress)
        const install = installInstructions(this.opts.capabilityInput, path)
        this.patch({ phase: 'downloaded', progressPercent: 100, downloadedPath: path, install })
        await this.opts.backend.openInstaller(path, install.action)
      }
    } catch (e) {
      // Back to `available`, not to `idle`: the update is still there and still worth offering,
      // and a failed download is a thing to retry rather than a thing to forget.
      this.patch({
        phase: 'available',
        progressPercent: null,
        error: e instanceof Error ? e.message : String(e),
      })
    }
    return this.status
  }

  /** `auto` only: restarts into the staged update. */
  install(): void {
    if (this.status.phase !== 'ready') return
    this.opts.backend.install()
  }

  /** `assisted` only: opens (or reveals) the installer again, for anyone who closed it. */
  async openDownloaded(): Promise<void> {
    const path = this.status.downloadedPath
    if (path === null) return
    await this.opts.backend.openInstaller(path, this.status.install?.action ?? 'open')
  }

  /** Dismisses this version for good — until a newer one arrives. */
  skip(): void {
    const version = this.status.availableVersion
    if (version === null) return
    this.opts.saveSettings({ skippedVersion: version })
    this.patch({ phase: 'idle', availableVersion: null, skippedVersion: version })
  }

  /** Dismisses the notice for now; the next check offers it again. */
  dismiss(): void {
    if (this.status.phase === 'available' || this.status.phase === 'up-to-date'
      || this.status.phase === 'error') {
      this.patch({ phase: 'idle', error: null })
    }
  }

  private patch(next: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...next }
    this.opts.onStatus(this.status)
  }
}
