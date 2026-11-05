import { NO_DISPLAY_SWITCH } from '@shared/launchFlags'

/**
 * Background launch (`--background`): the work machine's Apiary started over SSH by a home machine
 * (docs/proposals/2026-10-10-remote-access.md). It runs its services and remote server but opens no
 * window, and stays alive with none while remote access is on (it quits when that is off and no
 * window is open: `shouldQuitIdleBackground`). Pure, so a test can pin each decision.
 */
export interface LaunchMode {
  /** `--background` was on this process's command line. */
  background: boolean
  /**
   * `--update`: the command-line update (`update/cliUpdate.ts`). It installs the newest release from
   * a terminal and restarts the Apiary that is running, then exits; it opens no window and runs no
   * services of its own. With `--background` too, it also starts one in the background when none runs.
   */
  update: boolean
  /** `--install-service` / `--uninstall-service` (`update/backgroundService.ts`): a terminal command, like `update`. */
  service: 'install' | 'uninstall' | null
}

export function parseLaunchMode(argv: string[]): LaunchMode {
  const service = argv.includes('--install-service') ? 'install' : argv.includes('--uninstall-service') ? 'uninstall' : null
  return { background: argv.includes('--background'), update: argv.includes('--update'), service }
}

/** A command run from a terminal that does its job and exits, starting none of Apiary: `--update`, the service ones. */
export function isTerminalCommand(mode: LaunchMode): boolean {
  return mode.update || mode.service !== null
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
  // The command-line update runs beside the Apiary it updates, which holds the lock.
  return !isTerminalCommand(mode) && (packaged || mode.background)
}

/**
 * Whether Chromium must start with no display (`--ozone-platform=headless`): a background start or
 * the command-line update on Linux with neither `DISPLAY` nor `WAYLAND_DISPLAY`, as over SSH with nobody logged in to the
 * desktop. Without it Chromium exits at once ("Missing X server or $DISPLAY") before any of
 * Apiary runs. Such a process can never open a window, so a later normal launch joins it as a client.
 */
export function needsNoDisplay(mode: LaunchMode, platform: NodeJS.Platform, env: Record<string, string | undefined>): boolean {
  const blank = (v: string | undefined): boolean => v === undefined || v.trim() === ''
  return (mode.background || isTerminalCommand(mode)) && platform === 'linux' && blank(env.DISPLAY) && blank(env.WAYLAND_DISPLAY)
}

/**
 * Whether a normal launch joins the Apiary already running on its profile instead of handing over to
 * it: on Linux, with a display, when that one was started with no display (`needsNoDisplay`) and so
 * can open no window here. The launch then runs on a profile of its own (`desktopProfile`) and opens
 * the background one's windows over its socket, as a remote window does, so the sessions, terminals
 * and chats running there carry on. `runningArgs` are the running one's arguments, or null when none runs.
 */
export function shouldJoinBackground(
  mode: LaunchMode, platform: NodeJS.Platform, env: Record<string, string | undefined>, runningArgs: readonly string[] | null,
): boolean {
  if (mode.background || isTerminalCommand(mode) || platform !== 'linux' || runningArgs === null) return false
  const hasDisplay = [env.DISPLAY, env.WAYLAND_DISPLAY].some((v) => v !== undefined && v.trim() !== '')
  return hasDisplay && runningArgs.includes(NO_DISPLAY_SWITCH)
}

/** The joining launch's own profile, beside the one it joins: its windows' sizes, themes and pets. */
export function desktopProfile(userData: string): string {
  return `${userData}-desktop`
}
