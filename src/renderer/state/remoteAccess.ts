import type { RemoteClientInfo } from '@shared/domain/remote'
import { createIpcStore } from './createIpcStore'
import { bestEffort } from './policy'

/** The home machines connected to this machine over remote access (the work machine's view), kept
 *  current by `remoteClientsChanged`. Empty where there is no remote access. */
const clientsStore = createIpcStore<RemoteClientInfo[]>({
  scope: 'remote',
  initial: [],
  fetch: () => window.apiary.remoteClients(),
  subscribe: (push) => window.apiary.onRemoteClientsChanged(push),
})

export function useRemoteClients(): RemoteClientInfo[] {
  return clientsStore.useStore()
}

/** Settings → General → "Disconnect all…": main closes every connection and turns remote access off.
 *  Policy 3: the section awaits it and shows a failure inline. */
export const disconnectAllRemote = (): Promise<void> => window.apiary.remoteDisconnectAll()

/** The pairing code (`XXXX-XXXX`) this machine asks for while "Also require a pairing code" is on.
 *  Policy 1: null after logging when it failed, and the row says so. */
export const loadPairingCode = (): Promise<string | null> => bestEffort(window.apiary.remotePairing(), 'remote')

/** "New code": every home machine has to enter the new one. Policy 3. */
export const newPairingCode = (): Promise<string> => window.apiary.remotePairingNew()
