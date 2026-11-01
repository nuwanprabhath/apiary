/**
 * The updater's types, canonical here rather than mirrored — see `main/update/updateService.ts`
 * and `capability.ts`, which import these instead of redeclaring them.
 * `CapabilityInput` stays in main: it carries `NodeJS.Platform`, which shared code must never
 * depend on.
 */

import { isRecord } from '../guards'

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
  /** `assisted` install: the installer is verified and `sudo` wants the user's password. */
  | 'needs-password'
  /** `assisted` install: the verified installer is being installed. */
  | 'installing'
  /** Installed (or, on macOS, handed to the helper that installs after quit); Apiary is quitting. */
  | 'restarting'
  /** A check the user asked for that found nothing — worth saying so, unlike a silent one. */
  | 'up-to-date'
  | 'error'

export type UpdateCapabilityKind = 'auto' | 'assisted' | 'unsupported'

export interface Capability {
  kind: UpdateCapabilityKind
  /** Shown in Settings, so "why is there no update button" always has an answer on screen. */
  reason: string
}

/**
 * What the user has to do with an `assisted` download, once it is on disk. Decided in main, where
 * the platform is known.
 */
export interface InstallInstructions {
  /** The sentence the banner shows once the file is downloaded. */
  hint: string
  /** A command that finishes the job, ready to copy — or null where double-clicking is the answer. */
  command: string | null
  /**
   * What to do with the file when the user presses the button: hand it to the OS, or just show
   * them where it is. A `.deb` is `reveal`, because handing it over is the thing that fails.
   */
  action: 'open' | 'reveal'
}

export type OpenInstallerResult =
  | { ok: 'opened' }
  | { ok: 'revealed' }
  | { ok: 'failed'; reason: string }

/** What `updatePrepareInstall` answers: whether `updateInstallAndRestart` needs a password. */
export interface PrepareInstallResult {
  needsPassword: boolean
}

/**
 * `password`: sudo refused the password; `password-required`: sudo wanted one when none was sent
 * (its cache expired after the probe), so nothing was refused; `install`: anything else went wrong.
 */
export type InstallOutcome =
  | { ok: true }
  | { ok: false; reason: 'password' | 'password-required' | 'install'; message: string }

/** What `updateInstallAndRestart` is sent: the password for sudo, or null when none is needed. */
export interface InstallRequest {
  password: string | null
}

const MAX_PASSWORD_LENGTH = 1024

export function isInstallRequest(v: unknown): v is InstallRequest {
  if (!isRecord(v) || Object.keys(v).length !== 1) return false
  const { password } = v
  return password === null || (typeof password === 'string' && password.length <= MAX_PASSWORD_LENGTH)
}

/** The one sentence a refused password reads as, on every platform. */
export const PASSWORD_NOT_ACCEPTED = 'That password was not accepted.'

export interface UpdateStatusPayload {
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
  /** Null until an open or reveal has run. */
  openResult: OpenInstallerResult | null
  error: string | null
  /** The download in progress (or done) is for Install and restart, so nothing opens it. */
  installRequested: boolean
  /** Why the last install did not happen, in one sentence; null when nothing failed. */
  installError: string | null
  lastCheckedAt: number | null
  skippedVersion: string | null
}
