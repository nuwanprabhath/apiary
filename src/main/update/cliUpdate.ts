import { errorMessage } from '@shared/errors'
import type { Capability } from './capability'
import { relaunchCommand, relaunchEnv, SERVICE_UNIT, startCommand, systemdUserUnit, type Command } from './installCommands'
import type { RunningApiary } from './runningApiary'
import type { UpdateBackend } from './updateService'
import { isNewer } from './versions'
import { NO_DISPLAY_SWITCH } from '@shared/launchFlags'

/** Everything `apiary --update` reaches, so a test can drive every branch with none of it real. */
export interface CliUpdateDeps {
  currentVersion: string
  platform: NodeJS.Platform
  capability: Capability
  backend: Pick<UpdateBackend, 'check' | 'downloadInstaller'>
  allowPrerelease: boolean
  /** Writes to the terminal. */
  out: (text: string) => void
  /** Runs a command attached to the terminal (sudo asks for its password there); its exit code. */
  run: (command: Command, env?: Record<string, string>) => number
  /** The Apiary running on this profile, read again after the install. */
  running: () => RunningApiary | null
  /** SIGTERM, then SIGKILL after a grace period; resolves once the process has gone. */
  stop: (pid: number) => Promise<void>
  removeFile: (path: string) => Promise<void>
  /** The installed binary, which apt replaces in place. */
  execPath: string
  /** This command's own arguments after the binary (`--update`, maybe `--background`, `--user-data-dir=…`). */
  ownArgs: string[]
  ownEnv: Record<string, string | undefined>
}

const APT = (path: string): Command => ({ file: 'sudo', args: ['apt-get', 'install', '-y', '--allow-downgrades', path] })

/** The arguments a background Apiary is started with: this command's own, less `--update`. */
function backgroundArgs(ownArgs: string[]): string[] {
  const args = ownArgs.filter((a) => a !== '--update')
  return args.includes('--background') ? args : [...args, '--background']
}

/**
 * `apiary --update`, for a terminal: an SSH session with nobody at the desktop, say. It installs the
 * newest release as Install and restart does (the same feed, the same verified download, apt under
 * sudo, with sudo asking for the password in the terminal), then starts the running Apiary again in
 * the way it was started (its arguments, display and systemd unit). With `--background`, an Apiary
 * that was not running is started in the background. Resolves to the exit code.
 *
 * Only the `.deb` installation of Linux: an AppImage replaces itself, and a Mac's installs with a
 * helper once the app has quit, both from the update banner.
 */
export async function cliUpdate(deps: CliUpdateDeps): Promise<number> {
  const { out } = deps
  const wantsBackground = deps.ownArgs.includes('--background')
  if (deps.platform !== 'linux' || deps.capability.kind !== 'assisted') {
    out(`apiary --update installs the .deb on Linux. Here: ${deps.capability.reason} Use the update banner in Apiary instead.\n`)
    return 1
  }

  out(`Apiary ${deps.currentVersion}: checking for a newer version…\n`)
  let latest: string | null
  try {
    latest = (await deps.backend.check({ allowPrerelease: deps.allowPrerelease }))?.version ?? null
  } catch (e) {
    out(`Could not check for updates: ${errorMessage(e)}\n`)
    return 1
  }
  if (latest === null || !isNewer(deps.currentVersion, latest)) {
    out(`Apiary ${deps.currentVersion} is the newest version.\n`)
    return wantsBackground ? ensureBackground(deps) : 0
  }

  out(`Downloading Apiary ${latest}…\n`)
  let path: string
  try {
    let shown = -1
    path = await deps.backend.downloadInstaller((percent) => {
      const step = Math.floor(percent / 10) * 10
      if (step > shown) { shown = step; out(`  ${String(step)}%\n`) }
    })
  } catch (e) {
    out(`Could not download Apiary ${latest}: ${errorMessage(e)}\n`)
    return 1
  }

  out(`Installing Apiary ${latest} (sudo may ask for your password)…\n`)
  const installed = deps.run(APT(path), { DEBIAN_FRONTEND: 'noninteractive' })
  if (installed !== 0) {
    out(`apt-get could not install it (exit ${String(installed)}). The download is kept at ${path}.\n`)
    return installed
  }
  await deps.removeFile(path)
  out(`Installed Apiary ${latest}.\n`)

  const running = deps.running()
  if (running === null) return wantsBackground ? ensureBackground(deps) : (out('Apiary is not running. Start it with `apiary`, or `apiary --background` over SSH.\n'), 0)
  // The new one is started first: it waits for the old pid to exit, which holds the profile's lock.
  const display = relaunchEnv(running.env)
  const relaunch = relaunchCommand({
    pid: running.pid,
    binary: deps.execPath,
    // The new instance decides about a display for itself: the old one may have had none.
    args: running.args.filter((a) => a !== NO_DISPLAY_SWITCH),
    env: display,
    // The installed service, when it was started by it, is found on the parent (`parentCgroup`).
    unit: systemdUserUnit(running.parentCgroup) === SERVICE_UNIT ? SERVICE_UNIT : systemdUserUnit(running.cgroup),
  })
  // Its display and bus also for the `setsid` path, which takes no `--setenv`: a desktop Apiary
  // updated from an SSH shell comes back on its desktop.
  if (deps.run(relaunch, display) !== 0) {
    out('Could not start the new version. Apiary is still running the old one; quit it and start it again.\n')
    return 1
  }
  out(`Restarting the running Apiary (pid ${String(running.pid)})…\n`)
  await deps.stop(running.pid)
  out(`Done: Apiary ${latest} is starting.\n`)
  return 0
}

/** Starts Apiary in the background unless one already runs on this profile. */
function ensureBackground(deps: CliUpdateDeps): number {
  const running = deps.running()
  if (running !== null) {
    deps.out(`Apiary is already running (pid ${String(running.pid)}).\n`)
    return 0
  }
  const args = backgroundArgs(deps.ownArgs)
  const env = relaunchEnv(deps.ownEnv)
  // Under the user's systemd when there is one, as the remote start does; otherwise its own session.
  const code = deps.run(startCommand({ binary: deps.execPath, args, env, systemd: true }))
  const started = code === 0 ? 0 : deps.run(startCommand({ binary: deps.execPath, args, env, systemd: false }))
  deps.out(started === 0
    ? 'Started Apiary in the background. Connect to this machine from Apiary on your laptop.\n'
    : 'Could not start Apiary in the background.\n')
  return started
}
