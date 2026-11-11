import { errorMessage } from '@shared/errors'
import {
  decideCapability, installInstructions,
  type CapabilityInput,
} from './capability'
import { isNewer, shouldOffer } from './versions'
import { log } from '../log/logger'
import {
  PASSWORD_NOT_ACCEPTED,
  type UpdateStatusPayload, type Capability, type InstallInstructions, type OpenInstallerResult,
  type InstallOutcome, type PrepareInstallResult,
} from '@shared/domain/update'

export type { Capability, OpenInstallerResult }

/**
 * The updater's state machine and scheduler. Everything that talks to Electron, the network or the
 * disk is behind `UpdateBackend`, so the rules are testable in plain Node against a stub; the real
 * path can only be exercised by publishing a release.
 */

/** An alias of the wire shape `ApiaryApi.updateStatus` returns. */
export type UpdateStatus = UpdateStatusPayload

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
  openInstaller(path: string, action: InstallInstructions['action']): Promise<OpenInstallerResult>
  /** `assisted`: whether installing the file at `path` needs the user's sudo password. */
  needsPassword(path: string): Promise<boolean>
  /** Whether the file at `path` still hashes to the sha512 it was verified against when downloaded. */
  stillVerified(path: string): Promise<boolean>
  /**
   * `assisted`: installs the verified file (Linux), or hands it to the helper that installs it once
   * Apiary has quit (macOS).
   */
  installDownloaded(path: string, opts: { password: string | null; version: string }): Promise<InstallOutcome>
  /** Quits; the installed version starts once this process has exited. */
  restart(): void
  /** Quits and starts the copy of Apiary installed on disk, which is newer than this process. */
  relaunch(): void
  /** The outcome the macOS helper left from the last install, read once and deleted. */
  takePreviousInstall(): Promise<PreviousInstall | null>
}

/** What a helper that installed after quit (macOS) left for the next start to read. */
export interface PreviousInstall {
  version: string
  ok: boolean
  message: string
  /** The installer it kept, when it failed and the file is still there. */
  path: string | null
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
  /** The version of Apiary installed on disk, or null when it cannot be told (`installedVersion.ts`). */
  installedVersion?: () => Promise<string | null>
  /** Injected so tests can drive time; defaults to the real timers. */
  timers?: {
    setTimeout: (fn: () => void, ms: number) => NodeJS.Timeout | number
    clearTimeout: (handle: NodeJS.Timeout | number) => void
    now: () => number
  }
}

/** How long after launch the first automatic check happens; not zero, so it does not compete with startup. */
export const FIRST_CHECK_DELAY_MS = 30_000

/** First look at the installed version after launch, then every `INSTALLED_CHECK_INTERVAL_MS`. */
export const INSTALLED_FIRST_CHECK_DELAY_MS = 60_000
export const INSTALLED_CHECK_INTERVAL_MS = 10 * 60_000
/** A window gaining focus checks at most this often. */
export const INSTALLED_FOCUS_THROTTLE_MS = 60_000

const CHANGED_SINCE_VERIFIED = 'The downloaded file changed since it was verified, so it was not installed.'

const MIN_INTERVAL_HOURS = 1
const MAX_INTERVAL_HOURS = 24 * 7

export class UpdateService {
  private readonly opts: UpdateServiceOptions
  private readonly timers: NonNullable<UpdateServiceOptions['timers']>
  private readonly capability: Capability
  private timer: NodeJS.Timeout | number | null = null
  private inFlight = false
  private installedTimer: NodeJS.Timeout | number | null = null
  /** A newer installed version, as read; `status.installedVersion` is this unless hidden. */
  private installed: string | null = null
  private dismissedInstalled: string | null = null
  private loggedInstalled: string | null = null
  private installedCheckedAt: number | null = null

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
      openResult: null,
      error: null,
      installRequested: false,
      installError: null,
      lastCheckedAt: null,
      skippedVersion: opts.settings().skippedVersion,
      installedVersion: null,
    }
  }

  current(): UpdateStatus {
    return this.status
  }

  /** Starts (or restarts) the automatic schedule to match the current settings. */
  start(): void {
    this.stop()
    this.startInstalledChecks()
    if (this.capability.kind === 'unsupported') return
    if (!this.opts.settings().automaticChecks) return
    this.timer = this.timers.setTimeout(() => { void this.runScheduled() }, FIRST_CHECK_DELAY_MS)
  }

  stop(): void {
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer)
      this.timer = null
    }
    if (this.installedTimer !== null) {
      this.timers.clearTimeout(this.installedTimer)
      this.installedTimer = null
    }
  }

  private startInstalledChecks(): void {
    if (this.opts.installedVersion === undefined) return
    this.installedTimer = this.timers.setTimeout(() => { void this.runInstalledCheck() }, INSTALLED_FIRST_CHECK_DELAY_MS)
  }

  private async runInstalledCheck(): Promise<void> {
    await this.checkInstalled()
    this.installedTimer = this.timers.setTimeout(() => { void this.runInstalledCheck() }, INSTALLED_CHECK_INTERVAL_MS)
  }

  /** Reads the installed version and says so when it is newer than the running one. Never throws. */
  async checkInstalled(): Promise<void> {
    const read = this.opts.installedVersion
    if (read === undefined) return
    this.installedCheckedAt = this.timers.now()
    let version: string | null
    try {
      version = await read()
    } catch (e) {
      log.warn('update', 'could not read the installed version', { error: errorMessage(e) })
      version = null
    }
    this.installed = version !== null && isNewer(this.opts.currentVersion, version) ? version : null
    if (this.installed !== null && this.installed !== this.loggedInstalled) {
      this.loggedInstalled = this.installed
      log.info('update', 'installed version newer than running', { running: this.opts.currentVersion, installed: this.installed })
    }
    this.patch({})
  }

  /** A window gained focus: looks again, at most once a minute. */
  windowFocused(): void {
    if (this.opts.installedVersion === undefined) return
    const last = this.installedCheckedAt
    if (last !== null && this.timers.now() - last < INSTALLED_FOCUS_THROTTLE_MS) return
    void this.checkInstalled()
  }

  private shownInstalled(): string | null {
    const { installed } = this
    if (installed === null || installed === this.dismissedInstalled) return null
    const { phase, availableVersion } = this.status
    if (phase === 'downloading' || phase === 'installing' || phase === 'restarting' || phase === 'needs-password') return null
    if (availableVersion !== null && isNewer(installed, availableVersion)) return null
    return installed
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
   * Asks the feed whether there is anything newer. A manual check reports its outcome either way;
   * an automatic one stays silent unless it has something to offer, and puts its errors in the
   * status rather than interrupting (a laptop waking on captive-portal wifi).
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
        // A manual check ignores the skip: "up to date" would be a lie about the skipped version.
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
        error: errorMessage(e),
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
    return this.fetch({ forInstall: false })
  }

  private async fetch({ forInstall }: { forInstall: boolean }): Promise<UpdateStatus> {
    if (this.status.availableVersion === null) return this.status
    if (this.status.phase === 'downloading') return this.status
    this.patch({ phase: 'downloading', progressPercent: 0, error: null, installRequested: forInstall, installError: null })

    const onProgress = (percent: number): void => {
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
        // Install and restart installs the file itself; opening it too would start a second install.
        if (forInstall) return this.status
        const openResult = await this.opts.backend.openInstaller(path, install.action)
        this.patch({ openResult })
      }
    } catch (e) {
      // Back to `available`, not `idle`: the update is still worth offering and the download can be retried.
      this.patch({
        phase: 'available',
        progressPercent: null,
        error: errorMessage(e),
      })
    }
    return this.status
  }

  /** `auto` only: restarts into the staged update. */
  install(): void {
    // The newer files are already on disk, so restarting is all it takes.
    if (this.status.installedVersion !== null) { this.opts.backend.relaunch(); return }
    if (this.status.phase !== 'ready') return
    this.opts.backend.install()
  }

  /** `assisted` only: opens (or reveals) the installer again, for anyone who closed it. */
  async openDownloaded(): Promise<OpenInstallerResult> {
    const path = this.status.downloadedPath
    if (path === null) return { ok: 'failed', reason: 'Nothing has been downloaded yet.' }
    const openResult = await this.opts.backend.openInstaller(path, this.status.install?.action ?? 'open')
    this.patch({ openResult })
    return openResult
  }

  /**
   * Install and restart, first half (`assisted` only): downloads and verifies the installer unless
   * one is already on disk, then asks whether sudo needs a password. If it does, the status waits in
   * `needs-password` for `installAndRestart`; if not, this installs and restarts at once.
   */
  async prepareInstall(): Promise<PrepareInstallResult> {
    const { phase } = this.status
    if (this.capability.kind !== 'assisted' || (phase !== 'available' && phase !== 'downloaded')) {
      return { needsPassword: false }
    }
    if (this.status.downloadedPath === null) {
      await this.fetch({ forInstall: true })
      if (this.status.phase !== 'downloaded') return { needsPassword: false }
    }
    const path = this.status.downloadedPath
    if (path === null) return { needsPassword: false }
    this.patch({ installRequested: true, installError: null })
    let needsPassword: boolean
    try {
      needsPassword = await this.opts.backend.needsPassword(path)
    } catch (e) {
      this.patch({ phase: 'downloaded', installError: errorMessage(e) })
      return { needsPassword: false }
    }
    if (needsPassword) {
      this.patch({ phase: 'needs-password' })
      return { needsPassword: true }
    }
    await this.runInstall(path, null)
    return { needsPassword: false }
  }

  /** Install and restart, second half: only from `needs-password`, with the password the user typed. */
  async installAndRestart(password: string | null): Promise<InstallOutcome> {
    const path = this.status.downloadedPath
    if (this.status.phase !== 'needs-password' || path === null) {
      return { ok: false, reason: 'install', message: 'There is no verified installer waiting to be installed.' }
    }
    return this.runInstall(path, password)
  }

  private async runInstall(path: string, password: string | null): Promise<InstallOutcome> {
    const version = this.status.availableVersion ?? ''
    this.patch({ phase: 'installing', installError: null })
    let outcome: InstallOutcome
    try {
      outcome = await this.opts.backend.stillVerified(path)
        ? await this.opts.backend.installDownloaded(path, { password, version })
        : { ok: false, reason: 'install', message: CHANGED_SINCE_VERIFIED }
    } catch (e) {
      outcome = { ok: false, reason: 'install', message: errorMessage(e) }
    }
    if (outcome.ok) {
      this.patch({ phase: 'restarting', downloadedPath: null })
      this.opts.backend.restart()
    } else if (outcome.reason === 'password') {
      this.patch({ phase: 'needs-password', installError: PASSWORD_NOT_ACCEPTED })
    } else if (outcome.reason === 'password-required') {
      this.patch({ phase: 'needs-password', installError: null })
    } else if (outcome.message === CHANGED_SINCE_VERIFIED) {
      this.patch({ phase: 'available', downloadedPath: null, install: null, installError: outcome.message })
    } else {
      this.patch({ phase: 'downloaded', installError: outcome.message })
    }
    return outcome
  }

  /**
   * Called once at startup: when the macOS helper could not install the last update after quit, the
   * banner says so and offers the installer it kept. A success says nothing; the version is the proof.
   */
  async restorePreviousInstall(): Promise<void> {
    const previous = await this.opts.backend.takePreviousInstall()
    if (previous === null || previous.ok) return
    this.patch({
      phase: 'downloaded',
      availableVersion: previous.version,
      downloadedPath: previous.path,
      install: previous.path === null ? null : installInstructions(this.opts.capabilityInput, previous.path),
      installRequested: true,
      installError: previous.message,
    })
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
    if (this.status.installedVersion !== null) {
      this.dismissedInstalled = this.status.installedVersion
      this.patch({})
      return
    }
    if (this.status.phase === 'needs-password') {
      this.patch({ phase: 'available', installError: null })
      return
    }
    if (this.status.phase === 'available' || this.status.phase === 'up-to-date'
      || this.status.phase === 'error') {
      this.patch({ phase: 'idle', error: null })
    }
  }

  private patch(next: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...next }
    this.status.installedVersion = this.shownInstalled()
    this.opts.onStatus(this.status)
  }
}
