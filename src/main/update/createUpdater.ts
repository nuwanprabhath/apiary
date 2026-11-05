import { app } from 'electron'
import { UpdateService, type UpdateSettings } from './updateService'
import { decideCapability } from './capability'
import { createUpdateBackend } from './electronUpdaterBackend'
import { createFakeUpdateBackend } from './fakeBackend'
import { createPlatformInstaller } from './platformInstaller'
import { join } from 'node:path'
import { IPC } from '@shared/api'
import { broadcast } from '../windows/broadcast'
import type { SettingsService } from '../settings/settingsService'
import { rm } from 'node:fs/promises'
import { createSettingsStore } from '../settings'
import { homedir } from 'node:os'
import { installService, uninstallService } from './backgroundService'
import { removeFileForProgram, writeFileForProgram } from '../fs/textFile'
import { cliUpdate } from './cliUpdate'
import { findRunningApiary } from './runningApiary'
import { runInTerminal } from '../exec/runInTerminal'
import { ignoreErrors } from '@shared/ignoreErrors'

/** The two test hooks (`APIARY_FAKE_UPDATE*`, parsed in `app/env.ts`) the updater reads. */
interface UpdaterEnv {
  fakeUpdate: string | undefined
  fakeUpdateMode: string | undefined
  fakeUpdateFile: string | undefined
}

/**
 * Builds the updater, or returns null where there is nothing it could do.
 *
 * `macSigned` is whether `codesign` found a Developer ID authority on the running bundle
 * (`macSignature.ts`, asked once by `index.ts` at startup): an ad-hoc signature has none, and
 * Squirrel will refuse to replace such a bundle (`capability.ts`).
 */
export function createUpdater(settings: SettingsService, env: UpdaterEnv, macSigned: boolean): UpdateService | null {
  const repo = 'nuwanprabhath/apiary'
  // Test-only: pretend a release exists. Nothing here reaches the network or the disk.
  const fake = env.fakeUpdate
  const faking = fake !== undefined && fake !== ''

  // 'auto' is a Linux AppImage (installs itself), 'deb' a Linux .deb (assisted, and the case that
  // cannot be opened by the OS at all), anything else an unsigned macOS build.
  const fakeMode = env.fakeUpdateMode
  const capabilityInput = faking
    ? {
      platform: fakeMode === 'auto' || fakeMode === 'deb' ? ('linux' as const) : ('darwin' as const),
      packaged: true,
      appImagePath: fakeMode === 'auto' ? '/tmp/Apiary.AppImage' : undefined,
      macSigned: false,
    }
    : {
      platform: process.platform,
      packaged: app.isPackaged,
      appImagePath: process.env.APPIMAGE,
      macSigned: process.platform === 'darwin' && app.isPackaged && macSigned,
    }
  if (decideCapability(capabilityInput).kind === 'unsupported') return null

  const readUpdateSettings = (): UpdateSettings => {
    const s = settings.get()
    return {
      automaticChecks: s.updateAutomaticChecks,
      checkIntervalHours: s.updateCheckIntervalHours,
      autoDownload: s.updateAutoDownload,
      allowPrerelease: s.updateAllowPrerelease,
      skippedVersion: s.updateSkippedVersion,
    }
  }

  const installer = createPlatformInstaller({
    platform: process.platform,
    resultFile: join(app.getPath('userData'), 'update-result.json'),
    quit: () => { app.quit() },
  })
  const fakeFile = env.fakeUpdateFile === undefined || env.fakeUpdateFile === ''
    ? undefined
    : { path: env.fakeUpdateFile, downloadDir: app.getPath('downloads'), installer }

  const service = new UpdateService({
    currentVersion: app.getVersion(),
    capabilityInput,
    backend: faking
      ? createFakeUpdateBackend({ fake, fakeMode, fakeFile })
      : createUpdateBackend({ repo, platform: process.platform, arch: process.arch }, installer),
    settings: readUpdateSettings,
    saveSettings: (patch) => {
      if (patch.skippedVersion !== undefined) {
        settings.patch({ updateSkippedVersion: patch.skippedVersion })
      }
    },
    onStatus: (status) => { broadcast(IPC.updateChanged, status) },
  })
  return service
}

/** How long a running Apiary gets to quit on SIGTERM (it saves its layout and stops its terminals) before SIGKILL. */
const QUIT_GRACE_MS = 30_000

const isAlive = (pid: number): boolean => ignoreErrors(() => { process.kill(pid, 0); return true }, 'kill -0 fails once the process is gone') ?? false

/** SIGTERM, then SIGKILL once the grace period is over; resolves when the process has gone. */
async function stopProcess(pid: number): Promise<void> {
  ignoreErrors(() => process.kill(pid, 'SIGTERM'), 'it may have quit already')
  const until = Date.now() + QUIT_GRACE_MS
  while (isAlive(pid) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 200))
  if (isAlive(pid)) ignoreErrors(() => process.kill(pid, 'SIGKILL'), 'it may have quit just now')
  while (isAlive(pid)) await new Promise((resolve) => setTimeout(resolve, 200))
}

/**
 * `apiary --update` (`cliUpdate.ts`) with the real feed, download, terminal and processes. The
 * same test hooks as the banner's updater (`APIARY_FAKE_UPDATE*`), so the Docker suite can offer a
 * real .deb. Reads (never writes) the settings file for the prerelease preference: nothing else
 * of Apiary is started.
 */
export async function runCommandLineUpdate(env: UpdaterEnv): Promise<number> {
  const fake = env.fakeUpdate
  const faking = fake !== undefined && fake !== ''
  const platform = faking && env.fakeUpdateMode === 'deb' ? 'linux' : process.platform
  const capability = decideCapability(faking
    ? { platform, packaged: true, appImagePath: undefined, macSigned: false }
    : { platform: process.platform, packaged: app.isPackaged, appImagePath: process.env.APPIMAGE, macSigned: false })
  const installer = createPlatformInstaller({
    platform: process.platform,
    resultFile: join(app.getPath('userData'), 'update-result.json'),
    quit: () => { app.quit() },
  })
  const fakeFile = env.fakeUpdateFile === undefined || env.fakeUpdateFile === ''
    ? undefined
    : { path: env.fakeUpdateFile, downloadDir: app.getPath('downloads'), installer }
  const backend = faking
    ? createFakeUpdateBackend({ fake, fakeMode: env.fakeUpdateMode, fakeFile })
    : createUpdateBackend({ repo: 'nuwanprabhath/apiary', platform: process.platform, arch: process.arch }, installer)
  const userData = app.getPath('userData')
  return cliUpdate({
    currentVersion: app.getVersion(),
    platform,
    capability,
    backend,
    allowPrerelease: createSettingsStore(join(userData, 'settings.json')).load().updateAllowPrerelease,
    out: (text) => { process.stdout.write(text) },
    run: (command, extraEnv) => runInTerminal(command.file, command.args, { ...process.env, ...extraEnv }),
    running: () => findRunningApiary(userData),
    stop: stopProcess,
    removeFile: (path) => rm(path, { force: true }),
    execPath: process.execPath,
    ownArgs: process.argv.slice(1),
    ownEnv: process.env,
  })
}

/** `apiary --install-service` / `--uninstall-service` (`backgroundService.ts`) with the real files and terminal. */
export function runServiceCommand(kind: 'install' | 'uninstall'): number {
  if (process.platform !== 'linux') {
    process.stdout.write('The Apiary service is for Linux with systemd. On a Mac, open Apiary at login instead.\n')
    return 1
  }
  const deps = {
    execPath: process.env.APPIMAGE ?? process.execPath,
    leadingArgs: app.isPackaged ? [] : [app.getAppPath()],
    homeDir: homedir(),
    remoteAccessOn: createSettingsStore(join(app.getPath('userData'), 'settings.json')).load().remoteAccess,
    writeFile: writeFileForProgram,
    removeFile: removeFileForProgram,
    run: (command: { file: string; args: string[] }) => runInTerminal(command.file, command.args),
    out: (text: string) => { process.stdout.write(text) },
  }
  return kind === 'install' ? installService(deps) : uninstallService(deps)
}
