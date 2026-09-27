import { app } from 'electron'
import type { UpdateStatusPayload } from '@shared/api'
import type { UpdateService } from '../../update/updateService'
import type { SettingsService } from '../../settings/settingsService'
import type { Handlers } from '../registrar'

export interface UpdateDeps {
  settings: SettingsService
  updater?: UpdateService | null
}

type HandledKeys =
  | 'updateStatus' | 'updateCheck' | 'updateDownload' | 'updateInstall' | 'updateOpenDownloaded'
  | 'updateSkip' | 'updateDismiss'

/**
 * Every handler tolerates there being no updater at all — a dev run has none, and the renderer is
 * the same code either way, so it asks and gets an honest "unsupported" back rather than needing
 * to know which build it is running in.
 */
export function updateHandlers(deps: UpdateDeps): Pick<Handlers, HandledKeys> {
  const { updater } = deps

  const noUpdater = (): UpdateStatusPayload => ({
    phase: 'error',
    capability: { kind: 'unsupported', reason: 'Running from source — updates apply to installed builds only.' },
    currentVersion: app.getVersion(),
    availableVersion: null,
    releaseNotes: null,
    releaseUrl: null,
    progressPercent: null,
    downloadedPath: null,
    install: null,
    openResult: null,
    error: null,
    lastCheckedAt: null,
    skippedVersion: null,
  })

  return {
    updateStatus: (): UpdateStatusPayload => updater?.current() ?? noUpdater(),
    updateCheck: async (): Promise<UpdateStatusPayload> => (await updater?.check({ manual: true })) ?? noUpdater(),
    updateDownload: async (): Promise<UpdateStatusPayload> => (await updater?.download()) ?? noUpdater(),
    updateInstall: () => { updater?.install() },
    updateOpenDownloaded: async () =>
      (await updater?.openDownloaded()) ?? { ok: 'failed', reason: 'Running from source — there is no updater.' },
    // `UpdateService.skip()` already persists the skip through its own injected `saveSettings`
    // callback (wired to `SettingsService.patch` in `main/index.ts`), so nothing here writes
    // settings again — that used to be a second, redundant write to the same field (MAIN-16).
    updateSkip: () => { updater?.skip() },
    updateDismiss: () => { updater?.dismiss() },
  }
}
