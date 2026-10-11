import type { RemoteStatus } from '@shared/domain/remote'
import { createIpcStore } from './createIpcStore'

/**
 * This window's connection to its work machine: what main last said (`remoteStatusNow`, so a
 * reloaded window still knows it is disconnected) kept current by `remoteStatus`. Null in an
 * ordinary window, which is never sent one.
 */
export const remoteStatusStore = createIpcStore<RemoteStatus | null>({
  scope: 'remote',
  initial: null,
  fetch: () => window.apiary.remoteStatusNow(),
  subscribe: (push) => window.apiary.onRemoteStatus(push),
})

export const useRemoteStatus = (): RemoteStatus | null => remoteStatusStore.useStore()
