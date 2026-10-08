/**
 * The updater in the fake, modelled on main's `UpdateService`: a check looks at the release feed (a
 * fixture: `state.updateFeed`), then offers what is newer; skipping remembers the version; dismissing
 * only hides the notice; a download of an installer the user has to run ends `downloaded`. Every
 * step reaches every window as `updateChanged`. The contract (`tests/contract/clauses/update.ts`)
 * pins it.
 */
import type { ApiaryApi, UpdateStatusPayload } from '@shared/api'
import type { Env } from './state'

type UpdateApi = Pick<ApiaryApi,
  | 'updateStatus' | 'updateCheck' | 'updateDownload' | 'updateInstall' | 'updateOpenDownloaded' | 'updateSkip' | 'updateDismiss'>

export function updateApi(env: Env): UpdateApi {
  const { state, emit } = env
  const patch = (next: Partial<UpdateStatusPayload>): UpdateStatusPayload => {
    state.update = { ...state.update, ...next }
    emit('updateChanged', state.update)
    return state.update
  }

  return {
    updateStatus: async () => state.update,
    updateCheck: async () => {
      patch({ phase: 'checking', error: null })
      const feed = state.updateFeed
      // A check asked for by hand ignores a skipped version: it is asking about that one too.
      if (feed === null || feed === state.update.currentVersion) {
        return patch({ phase: 'up-to-date', availableVersion: null, lastCheckedAt: Date.now() })
      }
      return patch({ phase: 'available', availableVersion: feed, releaseNotes: 'Fixture release', releaseUrl: `https://example.invalid/${feed}`, lastCheckedAt: Date.now() })
    },
    updateDownload: async () => {
      const version = state.update.availableVersion
      if (version === null || state.update.phase === 'downloading') return state.update
      patch({ phase: 'downloading', progressPercent: 0, error: null })
      if (state.update.capability.kind === 'auto') return patch({ phase: 'ready', progressPercent: 100 })
      return patch({
        phase: 'downloaded',
        progressPercent: 100,
        downloadedPath: `/fixture/downloads/Apiary-${version}.dmg`,
        install: { hint: 'Open it and drag Apiary into Applications to finish updating.', command: null, action: 'open' },
        openResult: { ok: 'opened' },
      })
    },
    // Only a staged update restarts the app; the fixture must never quit anything.
    updateInstall: async () => {},
    updateOpenDownloaded: async () =>
      (state.update.downloadedPath === null ? { ok: 'failed', reason: 'Nothing has been downloaded yet.' } : { ok: 'opened' }),
    updateSkip: async () => {
      const version = state.update.availableVersion
      if (version === null) return
      patch({ phase: 'idle', availableVersion: null, skippedVersion: version })
    },
    updateDismiss: async () => {
      if (['available', 'up-to-date', 'error'].includes(state.update.phase)) patch({ phase: 'idle', error: null })
    },
  }
}
