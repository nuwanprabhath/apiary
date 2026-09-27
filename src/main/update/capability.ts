import type { Capability, InstallInstructions } from '@shared/domain/update'

export type { Capability, InstallInstructions } from '@shared/domain/update'

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
export interface CapabilityInput {
  platform: NodeJS.Platform
  /** `app.isPackaged` — false in a dev run, where there is no installer to replace. */
  packaged: boolean
  /** `process.env.APPIMAGE`, set by the AppImage runtime to the path of the running image. */
  appImagePath: string | undefined
  /** Whether the running macOS bundle carries a Developer ID signature (see `hasDeveloperIdSignature`). */
  macSigned: boolean
}

/** POSIX single-quoting, so a download path with a space in it survives being pasted. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * The volume and app name a downloaded `.dmg` mounts as, on every build electron-builder produces
 * for this project. Named rather than repeated, since the mac branch of `installInstructions`
 * below relies on both spellings matching the actual release artifact.
 */
const MAC_APP_NAME = 'Apiary'

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
  // No AppImage branch, deliberately. It used to hand out `chmod +x <file> && <file>` — the command
  // that failed on Ubuntu 22.04+ with "error loading libfuse.so.2" — for a download that only ever
  // reached a .deb installation by mistake. `pickInstaller` now always fetches the .deb on Linux.
  if (input.platform === 'darwin') {
    return {
      hint: 'Open it and drag Apiary into Applications to finish updating.',
      // One line rather than three separate steps to copy: mount the image quietly at a mountpoint
      // of our own, copy the bundle over whatever is already installed, detach so the Finder
      // window does not linger. Mounting at a fixed `/Volumes/${MAC_APP_NAME}` (SEC-7) copied from
      // whatever was already mounted there if a volume of that name existed — `hdiutil` appends
      // " 1" to the name it actually uses in that case, silently mounting the new image elsewhere
      // while the command still read from the old path. `mktemp -d` guarantees this run gets its
      // own, empty mountpoint.
      command: `m=$(mktemp -d) `
        + `&& hdiutil attach ${shellQuote(path)} -nobrowse -quiet -mountpoint "$m" `
        + `&& cp -R "$m/${MAC_APP_NAME}.app" /Applications/ `
        + `&& hdiutil detach "$m" -quiet`,
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
