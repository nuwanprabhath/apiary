/**
 * Background launch (`--background`): the work machine's Apiary started over SSH by a home machine
 * (docs/proposals/2026-10-10-remote-access.md). It runs its services and remote server but opens no
 * window, and stays alive with none while remote access is on (it quits when that is off and no
 * window is open: `shouldQuitIdleBackground`). Pure, so a test can pin each decision.
 */
export interface LaunchMode {
  /** `--background` was on this process's command line. */
  background: boolean
}

export function parseLaunchMode(argv: string[]): LaunchMode {
  return { background: argv.includes('--background') }
}

/** Whether startup opens a window (a restored one or a new one). A background launch opens none; a second, normal launch does. */
export function shouldOpenFirstWindow(mode: LaunchMode, secondLaunch: boolean): boolean {
  return !mode.background || secondLaunch
}

/** Whether closing the last window quits: macOS never does; a background-started app never does, so its remote server stays up. */
export function shouldQuitWhenNoWindows(mode: LaunchMode, platform: NodeJS.Platform): boolean {
  return platform !== 'darwin' && !mode.background
}

/**
 * Whether a background-started app has nothing left to do: remote access is off and no window is
 * open, or the server was refused its socket (another Apiary holds it), so it would sit invisible (on Linux there is no menu to quit it from). Checked at startup,
 * when the setting turns off and when the last window closes.
 */
export function shouldQuitIdleBackground(
  mode: LaunchMode, remoteAccess: boolean, openWindows: number, serverFailed = false,
): boolean {
  return mode.background && (!remoteAccess || serverFailed) && openWindows === 0
}

/**
 * Whether this process takes the one-Apiary-per-profile lock. A packaged app and a background start
 * do. A dev run (`npm start`) does not: on macOS its `apiary` userData folder is the installed
 * `Apiary`'s (the file system ignores case), so the lock would make it quit while the installed app runs.
 */
export function shouldHoldSingleInstanceLock(mode: LaunchMode, packaged: boolean): boolean {
  return packaged || mode.background
}
