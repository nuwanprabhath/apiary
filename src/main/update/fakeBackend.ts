import type { UpdateBackend } from './updateService'

export interface FakeUpdateBackendConfig {
  /** The version to report as available — `APIARY_FAKE_UPDATE`. */
  fake: string
  /** Which installer shape to fake — `APIARY_FAKE_UPDATE_MODE` (`auto`/`deb`/anything else = macOS). */
  fakeMode?: string
}

/**
 * The E2E test backend for `UpdateService` (MAIN-15 / TEST-6), moved out of `index.ts` so it can
 * be built and tested on its own. Touches nothing real: no network, no disk write, no install.
 * `openInstaller`'s `{ ok: 'opened' }` and `install()`'s no-op both exist because a test must never
 * actually quit the app or open a real file.
 */
export function createFakeUpdateBackend(config: FakeUpdateBackendConfig): UpdateBackend {
  const { fake, fakeMode } = config
  return {
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
  }
}
