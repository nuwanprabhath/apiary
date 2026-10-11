/**
 * Remote access's calls in the fake, as main (`main/remote/hostDirectory.ts`,
 * `remoteClientService.ts`) answers them. `remoteHostsChanged` follows the same calls it follows in
 * main: after each probe of a host, and after a connect that worked. The contract pins both.
 */
import type { ApiaryApi } from '@shared/api'
import { PAIRING_ALPHABET, type RemoteHost } from '@shared/domain/remote'
import type { Env } from './state'

type RemoteApi = Pick<ApiaryApi,
  'remoteConnect' | 'remoteStartAndConnect' | 'remoteHosts' | 'remoteClients' | 'remoteDisconnectAll' | 'remotePairing' | 'remotePairingNew'>

const MAX_HOSTS = 20
const REMOTE_OFF = (host: string): string =>
  `Apiary started on ${host}, but remote access is off there. Turn on Settings → General → Allow remote access over SSH on that machine.`

/** A new code as main shows it: 8 characters from the pairing alphabet as `XXXX-XXXX`. */
function freshPairingCode(): string {
  const picks = crypto.getRandomValues(new Uint32Array(8))
  const chars = Array.from(picks, (n) => PAIRING_ALPHABET[n % PAIRING_ALPHABET.length])
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`
}

export function remoteApi(env: Env): RemoteApi {
  const { state, emit } = env
  const announce = (): void => { emit('remoteHostsChanged', state.remoteHosts) }

  /** One probe, recorded and announced like main's; undefined when the fake has no answer for the host. */
  const probe = (name: string): { status: RemoteHost['status']; detail?: string } | undefined => {
    const found = state.remoteProbes[name]
    if (found === undefined) return undefined
    state.remoteHosts = state.remoteHosts.map((h) => {
      if (h.name !== name) return h
      const { detail: _old, ...rest } = h
      return { ...rest, status: found.status, ...(found.detail !== undefined ? { detail: found.detail } : {}), checkedAt: Date.now() }
    })
    announce()
    return found
  }

  /** A connection worked: the host goes first in the recent list, known to be ready. */
  const connected = (host: string): void => {
    const others = state.remoteHosts.filter((h) => h.name !== host)
    state.remoteHosts = [{ name: host, source: 'recent' as const, status: 'ready' as const, checkedAt: Date.now() }, ...others].slice(0, MAX_HOSTS)
    announce()
  }

  const connect = (host: string, pairing: string | undefined): void => {
    const failure = state.remoteConnectRule?.(host, pairing) ?? null
    if (failure !== null) throw new Error(failure)
    connected(host)
  }

  return {
    // Main opens the remote window itself; this window only learns whether it worked. A test sets
    // `state.remoteConnectError` to make it fail with that message (`remoteStartAndConnect` has its own,
    // `remoteStartError`, and `remoteConnectRule` decides for both).
    remoteConnect: async (host, pairing) => {
      state.remoteConnects.push(host)
      state.remoteConnectPairings.push(pairing)
      if (state.remoteConnectError !== null) throw new Error(state.remoteConnectError)
      connect(host, pairing)
    },
    remoteStartAndConnect: async (host) => {
      state.remoteStarts.push(host)
      if (state.remoteStartError !== null) throw new Error(state.remoteStartError)
      const found = probe(host)
      if (found !== undefined) {
        if (found.status === 'unreachable' || found.status === 'refused') throw new Error(found.detail)
        if (found.status !== 'ready') throw new Error(REMOTE_OFF(host))
      }
      connect(host, undefined)
    },
    // Main answers with its cache and probes each listed host when asked to, announcing each result as it arrives.
    remoteHosts: async (asked) => {
      state.remoteHostProbes.push(asked)
      const listed = state.remoteHosts
      if (asked) {
        const names = listed.map((h) => h.name)
        void (async () => { for (const name of names) { await Promise.resolve(); probe(name) } })()
      }
      return listed
    },
    remoteClients: async () => state.remoteClients,
    // Main closes every connection and turns remote access off; the list empties and is announced.
    remoteDisconnectAll: async () => {
      state.remoteDisconnects += 1
      const had = state.remoteClients.length > 0
      state.remoteClients = []
      state.settings = { ...state.settings, remoteAccess: false }
      if (had) emit('remoteClientsChanged', [])
    },
    remotePairing: async () => state.remotePairingCode,
    remotePairingNew: async () => {
      let code = state.remotePairingCode
      // A component test may name the code it expects next (`remoteNextPairingCodes`); otherwise it is drawn.
      while (code === state.remotePairingCode) code = state.remoteNextPairingCodes.shift() ?? freshPairingCode()
      state.remotePairingCode = code
      return state.remotePairingCode
    },
  }
}
