/**
 * The updater's types, canonical here rather than mirrored — see `main/update/updateService.ts`
 * and `capability.ts`, which import these instead of redeclaring them (MAIN-22 / SHARED-2).
 * `CapabilityInput` stays in main: it carries `NodeJS.Platform`, which shared code must never
 * depend on (SHARED-5).
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

export type UpdateCapabilityKind = 'auto' | 'assisted' | 'unsupported'

export interface Capability {
  kind: UpdateCapabilityKind
  /** Shown in Settings, so "why is there no update button" always has an answer on screen. */
  reason: string
}

/**
 * What the user has to do with an `assisted` download, once it is on disk. Decided in main, where
 * the platform is already known, and travels to the UI as words rather than being reinvented there.
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

/** What the last attempt to open or reveal a downloaded installer actually did. */
export type OpenInstallerResult =
  | { ok: 'opened' }
  | { ok: 'revealed' }
  | { ok: 'failed'; reason: string }

/** The updater's full state, for the banner and the Settings panel. */
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
  /** What the last attempt to open/reveal the installer actually did. Null until one has run. */
  openResult: OpenInstallerResult | null
  error: string | null
  lastCheckedAt: number | null
  skippedVersion: string | null
}
