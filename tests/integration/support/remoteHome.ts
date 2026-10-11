import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pairingSeenMessage, REMOTE_WORLD } from '../../contract/world'
import type { ConnectingOutside } from '../../../src/main/app/remoteContainer'
import type { ClientConnection } from '../../../src/main/remote/remoteClientService'

/** The host an ssh invocation of `sshCommand.ts` is for: the word after `--`. */
export function hostOfSshArgs(args: string[]): string {
  const at = args.indexOf('--')
  return at < 0 ? '' : args[at + 1] ?? ''
}

const noMachine = (host: string): Error => new Error(`ssh: Could not resolve hostname ${host}: Name or service not known`)

/** `remote-hosts.json` as `REMOTE_WORLD.recent` says; returns its path. */
export function seedRemoteHosts(home: string): string {
  const file = join(home, 'remote-hosts.json')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ version: 1, hosts: REMOTE_WORLD.recent }))
  return file
}

/**
 * The outside world of `createRemoteConnecting` with no ssh, no `tailscale` and no second machine,
 * so the loopback runs the app's own home-side wiring. The probe answers from `REMOTE_WORLD.probes`
 * the way `probeArgs`'s script prints; `up` connects, `pairing` is a work machine whose Apiary
 * refuses naming the pairing code it was sent, and any other host fails the way ssh does when it
 * cannot resolve a name (the canned stderr `describeSshFailure` turns into a sentence).
 */
export function loopbackConnectingOutside(home: string): ConnectingOutside {
  const probes: Record<string, string> = REMOTE_WORLD.probes
  const connection: ClientConnection = {
    host: REMOTE_WORLD.up, isClosed: false, layouts: () => Promise.resolve([]), close: () => {},
    openWindow: () => {}, closeWindow: () => {}, invoke: () => Promise.resolve(undefined), send: () => {},
    onEvent: () => () => {}, onClosed: () => () => {}, resolve: () => Promise.resolve({ path: home }),
  }
  return {
    tailscaleExec: () => Promise.reject(new Error('no tailscale')),
    probeExec: (_command, args) => {
      const host = hostOfSshArgs(args)
      const answer = probes[host]
      return answer === undefined ? Promise.reject(noMachine(host)) : Promise.resolve(`${answer}\n`)
    },
    sshExec: (_command, args) => {
      const host = hostOfSshArgs(args)
      // `homeDirArgs` asks for $HOME; anything else is the script that starts Apiary, which "works".
      if (!args.includes('printf')) return Promise.resolve('')
      return host === REMOTE_WORLD.up || host === REMOTE_WORLD.pairing ? Promise.resolve('/home/me') : Promise.reject(noMachine(host))
    },
    startTunnel: () => ({ exited: new Promise<void>(() => {}), stderr: () => '', stop: () => Promise.resolve() }),
    connect: (_socket, options) => (options.host === REMOTE_WORLD.pairing
      ? Promise.reject(new Error(pairingSeenMessage(options.pairing)))
      : Promise.resolve(connection)),
    // No keychain in the loopback: codes are not kept, as on a machine without one.
    cipher: { available: () => false, encrypt: () => '', decrypt: () => '' },
    makeTempDir: () => Promise.resolve(join(home, 'tunnel')), removeDir: () => Promise.resolve(), socketExists: () => true,
    startWait: { startWaitMs: 1, startPollMs: 1 },
  }
}
