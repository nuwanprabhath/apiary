/**
 * The updater in the fake, modelled on main's `UpdateService`: a check looks at the release feed (a
 * fixture: `state.updateFeed`), then offers what is newer; skipping remembers the version; dismissing
 * only hides the notice; a download of an installer the user has to run ends `downloaded`. Every
 * step reaches every window as `updateChanged`. The contract (`tests/contract/clauses/update.ts`)
 * pins it.
 */
import type { ApiaryApi, UpdateStatusPayload } from '@shared/api'
import { PASSWORD_NOT_ACCEPTED, type InstallOutcome } from '@shared/domain/update'
import type { Env } from './state'

type UpdateApi = Pick<ApiaryApi,
  | 'updateStatus' | 'updateCheck' | 'updateDownload' | 'updateInstall' | 'updateOpenDownloaded' | 'updateSkip' | 'updateDismiss'
  | 'updatePrepareInstall' | 'updateInstallAndRestart'>

const MAC_INSTALL = { hint: 'Open it and drag Apiary into Applications to finish updating.', command: null, action: 'open' } as const

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
        install: MAC_INSTALL,
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
      if (state.update.installedVersion !== null) { patch({ installedVersion: null }); return }
      if (state.update.phase === 'needs-password') patch({ phase: 'available', installError: null })
      else if (['available', 'up-to-date', 'error'].includes(state.update.phase)) patch({ phase: 'idle', error: null })
    },
    updatePrepareInstall: async () => {
      const { phase, availableVersion, capability } = state.update
      if (capability.kind !== 'assisted' || availableVersion === null || (phase !== 'available' && phase !== 'downloaded')) {
        return { needsPassword: false }
      }
      if (state.update.downloadedPath === null) {
        patch({ phase: 'downloading', progressPercent: 0, error: null, installRequested: true, installError: null })
        patch({ phase: 'downloaded', progressPercent: 100, downloadedPath: `/fixture/downloads/Apiary-${availableVersion}.dmg`, install: MAC_INSTALL })
      }
      patch({ installRequested: true, installError: null })
      if (state.updateSudo.password !== null) {
        patch({ phase: 'needs-password' })
        return { needsPassword: true }
      }
      install(null)
      return { needsPassword: false }
    },
    updateInstallAndRestart: async ({ password }) => {
      if (state.update.phase !== 'needs-password') {
        return { ok: false, reason: 'install', message: 'There is no verified installer waiting to be installed.' }
      }
      return install(password)
    },
  }

  function install(password: string | null): InstallOutcome {
    patch({ phase: 'installing', installError: null })
    if (state.updateSudo.password !== null && password !== state.updateSudo.password) {
      patch({ phase: 'needs-password', installError: PASSWORD_NOT_ACCEPTED })
      return { ok: false, reason: 'password', message: PASSWORD_NOT_ACCEPTED }
    }
    if (state.updateSudo.failure !== null) {
      patch({ phase: 'downloaded', installError: state.updateSudo.failure })
      return { ok: false, reason: 'install', message: state.updateSudo.failure }
    }
    // Main quits here; the fixture must never quit anything.
    patch({ phase: 'restarting', downloadedPath: null })
    return { ok: true }
  }
}
