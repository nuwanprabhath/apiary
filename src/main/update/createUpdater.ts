import { app } from 'electron'
import { UpdateService, type UpdateSettings } from './updateService'
import { decideCapability } from './capability'
import { createUpdateBackend } from './electronUpdaterBackend'
import { createFakeUpdateBackend } from './fakeBackend'
import { IPC } from '@shared/api'
import { broadcast } from '../windows/broadcast'
import type { SettingsService } from '../settings/settingsService'

/** The two test hooks (`APIARY_FAKE_UPDATE*`, parsed in `app/env.ts`) the updater reads. */
interface UpdaterEnv {
  fakeUpdate: string | undefined
  fakeUpdateMode: string | undefined
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

  return new UpdateService({
    currentVersion: app.getVersion(),
    capabilityInput,
    backend: faking
      ? createFakeUpdateBackend({ fake, fakeMode })
      : createUpdateBackend({ repo, platform: process.platform, arch: process.arch }),
    settings: readUpdateSettings,
    saveSettings: (patch) => {
      if (patch.skippedVersion !== undefined) {
        settings.patch({ updateSkippedVersion: patch.skippedVersion })
      }
    },
    onStatus: (status) => { broadcast(IPC.updateChanged, status) },
  })
}
