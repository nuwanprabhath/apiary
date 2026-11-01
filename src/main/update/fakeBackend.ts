import { copyFile, mkdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { UpdateBackend } from './updateService'
import { hashFile, type PlatformInstaller } from './platformInstaller'

export interface FakeUpdateBackendConfig {
  /** The version to report as available — `APIARY_FAKE_UPDATE`. */
  fake: string
  /** Which installer shape to fake — `APIARY_FAKE_UPDATE_MODE` (`auto`/`deb`/anything else = macOS). */
  fakeMode?: string
  /**
   * A real installer to "download" — `APIARY_FAKE_UPDATE_FILE`. With it, the download is a copy into
   * `downloadDir` verified by its real sha512, and Install and restart runs the real `installer`:
   * the Docker e2e installs a real .deb this way.
   */
  fakeFile?: { path: string; downloadDir: string; installer: PlatformInstaller }
}

/**
 * The E2E test backend for `UpdateService`. Without a fake file it touches nothing real: no network,
 * no disk write, no install. `openInstaller`'s `{ ok: 'opened' }` and the install and restart no-ops
 * exist because a test must never actually quit the app or open a real file.
 */
export function createFakeUpdateBackend(config: FakeUpdateBackendConfig): UpdateBackend {
  const { fake, fakeMode, fakeFile } = config
  const base: UpdateBackend = {
    check: async () => ({
      version: fake,
      releaseNotes: 'Fixture release',
      releaseUrl: `https://example.invalid/${fake}`,
    }),
    downloadForInstall: async (onProgress) => { onProgress(100) },
    install: () => { /* A test must not quit the app. */ },
    downloadInstaller: async (onProgress) => {
      onProgress(100)
      // The extension is what decides the instructions, so the fixture has to get it right.
      return fakeMode === 'deb' ? `/tmp/apiary_${fake}_amd64.deb` : `/tmp/Apiary-${fake}.dmg`
    },
    openInstaller: async () => ({ ok: 'opened' as const }),
    needsPassword: async () => false,
    stillVerified: async () => true,
    installDownloaded: async () => ({ ok: true }),
    restart: () => { /* A test must not quit the app. */ },
    takePreviousInstall: async () => null,
  }
  if (fakeFile === undefined) return base

  const { installer } = fakeFile
  return {
    ...base,
    downloadInstaller: async (onProgress) => {
      await mkdir(fakeFile.downloadDir, { recursive: true })
      const target = join(fakeFile.downloadDir, basename(fakeFile.path))
      await rm(target, { force: true })
      await copyFile(fakeFile.path, target)
      installer.recordVerified(target, await hashFile(target))
      onProgress(100)
      return target
    },
    needsPassword: (path) => installer.needsPassword(path),
    stillVerified: (path) => installer.stillVerified(path),
    installDownloaded: (path, opts) => installer.installDownloaded(path, opts),
    restart: () => { installer.restart() },
    takePreviousInstall: () => installer.takePreviousInstall(),
  }
}
