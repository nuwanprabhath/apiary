import type { PairingStore } from '../../remote/pairingStore'
import type { RemoteServer } from '../../remote/remoteServer'
import type { Handlers } from '../registrar'

type HandledKeys = 'remoteClients' | 'remoteDisconnectAll' | 'remotePairing' | 'remotePairingNew'

/**
 * The work machine's side of remote access, for its own Settings: who is connected, "Disconnect
 * all", and the optional pairing code. The server and the store own the behaviour; whether a code
 * is asked for is the server's own check of the setting.
 */
export function remoteClientsHandlers(
  deps: { server: RemoteServer | null; pairing: PairingStore | null },
): Pick<Handlers, HandledKeys> {
  return {
    remoteClients: () => deps.server?.clients() ?? [],
    remoteDisconnectAll: () => { deps.server?.disconnectAll() },
    remotePairing: () => {
      if (deps.pairing === null) throw new Error('Pairing codes are not available here.')
      return deps.pairing.display()
    },
    remotePairingNew: () => {
      if (deps.pairing === null) throw new Error('Pairing codes are not available here.')
      deps.pairing.regenerate()
      return deps.pairing.display()
    },
  }
}
