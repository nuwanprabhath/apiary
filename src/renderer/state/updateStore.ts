import type { UpdateStatusPayload } from '@shared/api'
import { createIpcStore } from './createIpcStore'
import { background } from './policy'

/**
 * The updater's state, as the UI sees it: one subscription shared by the banner and the Settings
 * panel. Main owns the state and pushes the whole status on every transition; one pushed while the
 * first read is in flight wins over it.
 */
const updateStore = createIpcStore<UpdateStatusPayload | null>({
  scope: 'update',
  initial: null,
  fetch: () => window.apiary.updateStatus(),
  subscribe: (push) => window.apiary.onUpdateChanged(push),
})

export function useUpdate(): UpdateStatusPayload | null {
  return updateStore.useStore()
}

// The pushed status is the feedback, so the banner's buttons are fire-and-forget: a failure is
// logged, not toasted over the banner.

export function downloadUpdate(): void { background(window.apiary.updateDownload(), 'update') }
export function installUpdate(): void { background(window.apiary.updateInstall(), 'update') }
export function skipUpdate(): void { background(window.apiary.updateSkip(), 'update') }
export function dismissUpdate(): void { background(window.apiary.updateDismiss(), 'update') }
/** What "Open installer" did; the banner words each outcome (and a rejection) itself. */
export const openDownloadedUpdate = (): ReturnType<typeof window.apiary.updateOpenDownloaded> =>
  window.apiary.updateOpenDownloaded()
/** Settings → Updates → Check now: the answer is what this resolves with. */
export const checkForUpdate = (): Promise<UpdateStatusPayload> => window.apiary.updateCheck()
