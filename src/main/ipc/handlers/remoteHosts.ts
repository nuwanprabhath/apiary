import type { HostDirectory } from '../../remote/hostDirectory'
import type { Handlers } from '../registrar'

type HandledKeys = 'remoteHosts'

/** Validates (the contract's guard has run) and delegates: the list, the cache and the probes are the directory's. */
export function remoteHostsHandlers(deps: { hosts: HostDirectory | null }): Pick<Handlers, HandledKeys> {
  return {
    remoteHosts: async (_e, probe) => (deps.hosts === null ? [] : deps.hosts.hosts(probe)),
  }
}
