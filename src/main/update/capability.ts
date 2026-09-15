/**
 * What this particular installation is allowed to do about an update.
 *
 * This is the constraint the whole updater is shaped around, so it is worth stating plainly.
 * Squirrel.Mac will only replace an app bundle whose code signature satisfies the *running*
 * app's designated requirement. Apiary ships unsigned (an ad-hoc signature, whose requirement is
 * a hash of the bundle itself), so a downloaded build can never satisfy it and an in-place install
 * on macOS fails at the last step — after downloading, which is the worst place to find out.
 *
 * Rather than discover that at install time, the capability is decided up front and the UI offers
 * only what will actually work:
 *
 * - `auto`      — download and install ourselves, then relaunch. Linux AppImage; macOS once it is
 *                 signed with a Developer ID certificate.
 * - `assisted`  — download the installer, check it, and hand it to the user to run. Unsigned
 *                 macOS, and Linux .deb (which needs root to install and must not be attempted
 *                 from inside the app).
 * - `unsupported` — there is nothing sensible to install: a dev run, or an unpackaged tree.
 *
 * The point of the split is that the day a Developer ID certificate exists, macOS returns `auto`
 * from here and every other part of the updater already does the right thing.
 */
export type UpdateCapability = 'auto' | 'assisted' | 'unsupported'

export interface CapabilityInput {
  platform: NodeJS.Platform
  /** `app.isPackaged` — false in a dev run, where there is no installer to replace. */
  packaged: boolean
  /** `process.env.APPIMAGE`, set by the AppImage runtime to the path of the running image. */
  appImagePath: string | undefined
  /** Whether the running macOS bundle carries a Developer ID signature (see `hasDeveloperIdSignature`). */
  macSigned: boolean
}

export interface Capability {
  kind: UpdateCapability
  /** Shown in Settings, so "why is there no update button" always has an answer on screen. */
  reason: string
}

/**
 * What the user has to do with an `assisted` download, once it is on disk.
 *
 * This exists because the banner used to say "Open it and drag Apiary into Applications" on every
 * platform. On Ubuntu that sentence describes nothing that exists, next to a button that did
 * nothing — `shell.openPath` on a `.deb` is a no-op on a desktop with no handler registered for
 * one, and it reports success, so even the fallback never fired.
 *
 * So the instruction is decided where the platform is already known, beside the capability, and
 * travels to the UI as words rather than being reinvented there.
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

/** POSIX single-quoting, so a download path with a space in it survives being pasted. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** The instructions for a downloaded installer at `path`. Pure, so the wording is testable. */
export function installInstructions(input: CapabilityInput, path: string): InstallInstructions {
  if (input.platform === 'linux' && path.endsWith('.deb')) {
    return {
      // Not "double-click it": installing a .deb needs root, and Ubuntu 24.04's desktop has no
      // handler for one at all, so the honest instruction is the command that works everywhere.
      hint: 'Installing a .deb needs root, so Apiary cannot do it for you. Run this to finish:',
      command: `sudo apt install ${shellQuote(path)}`,
      action: 'reveal',
    }
  }
  if (input.platform === 'darwin') {
    return {
      hint: 'Open it and drag Apiary into Applications to finish updating.',
      command: null,
      action: 'open',
    }
  }
  return { hint: 'Open it to finish updating.', command: null, action: 'open' }
}

export function decideCapability(input: CapabilityInput): Capability {
  if (!input.packaged) {
    return { kind: 'unsupported', reason: 'Running from source — updates apply to installed builds only.' }
  }

  if (input.platform === 'darwin') {
    return input.macSigned
      ? { kind: 'auto', reason: 'Signed build — updates install themselves.' }
      : {
        kind: 'assisted',
        // Said in terms of what the user will see happen, not in terms of Squirrel.
        reason: 'Unsigned build — macOS will not let an app replace itself, so the download opens '
          + 'for you to drag into Applications.',
      }
  }

  if (input.platform === 'linux') {
    return input.appImagePath !== undefined && input.appImagePath !== ''
      ? { kind: 'auto', reason: 'AppImage — updates install themselves.' }
      : {
        kind: 'assisted',
        reason: 'Installed from a .deb package, which needs root to update — the download opens '
          + 'for you to install.',
      }
  }

  if (input.platform === 'win32') {
    return { kind: 'auto', reason: 'Updates install themselves.' }
  }

  return { kind: 'unsupported', reason: `No update mechanism for ${input.platform}.` }
}
