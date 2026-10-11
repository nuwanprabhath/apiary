import type { RemoteClientService } from '../../remote/remoteClientService'
import type { Handlers } from '../registrar'

type HandledKeys = 'remoteConnect' | 'remoteStartAndConnect'

/** Validates (the contract's guard has run) and delegates: ssh, the socket and the window are the service's. */
export function remoteConnectHandlers(deps: { remoteClient: RemoteClientService | null }): Pick<Handlers, HandledKeys> {
  return {
    remoteConnect: async (_e, host, pairing) => {
      if (deps.remoteClient === null) throw new Error('Remote connections are not available here.')
      await deps.remoteClient.connect(host, pairing)
    },
    remoteStartAndConnect: async (_e, host) => {
      if (deps.remoteClient === null) throw new Error('Remote connections are not available here.')
      await deps.remoteClient.startRemoteApp(host)
    },
  }
}
