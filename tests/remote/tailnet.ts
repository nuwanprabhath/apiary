import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { vi } from 'vitest'
import { run, type Bed, type Run } from './harness'

const REPO = resolve(import.meta.dirname, '../..')
const MAC_TAILSCALE = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale']
const SOCKET = '/var/run/tailscale/tailscaled.sock'

/**
 * The auth key for the test node: `TS_AUTHKEY` from the environment, else from the repo's `.env`
 * (gitignored and dockerignored). Only that one key is read, so nothing else in `.env` reaches
 * process.env and from there the home app's environment.
 */
export function tailnetAuthKey(): string | undefined {
  const fromEnv = process.env.TS_AUTHKEY
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv
  const file = join(REPO, '.env')
  if (!existsSync(file)) return undefined
  const key = parseEnv(readFileSync(file, 'utf8')).TS_AUTHKEY
  return key !== undefined && key !== '' ? key : undefined
}

/** This Mac's `tailscale` CLI (the Homebrew/standalone one, else the app's). */
export async function macTailscale(args: string[]): Promise<Run> {
  let last: Run = { code: null, stdout: '', stderr: 'no tailscale CLI' }
  for (const cli of MAC_TAILSCALE) {
    last = await run(cli, args, 30_000)
    if (last.code === 0) return last
  }
  return last
}

export interface TailnetNode {
  /** The node's name on the tailnet (`--hostname`). */
  hostName: string
  /** Its MagicDNS name, e.g. `apiary-test-bed-123.tail1234.ts.net`. */
  dnsName: string
  /** Its tailnet IPv4 address. */
  ip: string
}

interface Status { BackendState?: string; AuthURL?: string; Self?: { DNSName?: string } }

async function nodeStatus(bed: Bed): Promise<Status> {
  const r = await bed.exec(['tailscale', `--socket=${SOCKET}`, 'status', '--json'])
  try { return JSON.parse(r.stdout) as Status } catch { return {} }
}

/**
 * Joins the container to the tailnet as an ephemeral node: tailscaled in userspace mode (Docker
 * Desktop gives a container no TUN device) with its state in memory, so the node is removed when
 * it logs out or goes away. With `authKey` it joins at once; without one, `onLoginUrl` gets the
 * link a person opens to sign in, and this waits up to ten minutes for them.
 */
export async function joinTailnet(bed: Bed, authKey: string | undefined, onLoginUrl: (url: string) => void): Promise<TailnetNode> {
  const hostName = `apiary-test-bed-${String(process.pid)}`
  await bed.exec(['sh', '-c', `mkdir -p /var/run/tailscale && nohup tailscaled --tun=userspace-networking --state=mem: --socket=${SOCKET} >/var/log/tailscaled.log 2>&1 &`])
  await vi.waitFor(async () => {
    if ((await bed.exec(['test', '-S', SOCKET])).code !== 0) throw new Error('tailscaled not up yet')
  }, { timeout: 30_000, interval: 500 })

  const up = `tailscale --socket=${SOCKET} up --hostname=${hostName} --accept-dns=false`
  if (authKey !== undefined) {
    // Through stdin into a 0600 file the container deletes straight after: never in argv on this
    // Mac, never in the image, never in a log.
    const r = await bed.execWithInput(['sh', '-c',
      `umask 077 && cat > /run/ts-authkey && ${up} --auth-key=file:/run/ts-authkey; code=$?; rm -f /run/ts-authkey; exit $code`], authKey)
    if (r.code !== 0) throw new Error(`tailscale up with the auth key failed: ${r.stderr.slice(-1000)}`)
  } else {
    await bed.exec(['sh', '-c', `nohup ${up} >/var/log/tailscale-up.log 2>&1 &`])
    let shown = false
    await vi.waitFor(async () => {
      const s = await nodeStatus(bed)
      if (!shown && s.AuthURL !== undefined && s.AuthURL !== '') { shown = true; onLoginUrl(s.AuthURL) }
      if (s.BackendState !== 'Running') throw new Error(`waiting for the sign-in (state ${String(s.BackendState)})`)
    }, { timeout: 600_000, interval: 2000 })
  }

  const s = await nodeStatus(bed)
  const dnsName = (s.Self?.DNSName ?? '').replace(/\.$/, '')
  const ip = (await bed.exec(['tailscale', `--socket=${SOCKET}`, 'ip', '-4'])).stdout.trim()
  if (dnsName === '' || ip === '') throw new Error(`joined, but no name or address: ${JSON.stringify(s).slice(0, 500)}`)
  return { hostName, dnsName, ip }
}

/** Turns Tailscale SSH on or off for the node (`tailscale set --ssh`), as `tailscale up --ssh` does at work. */
export async function setTailscaleSsh(bed: Bed, on: boolean): Promise<void> {
  const r = await bed.exec(['tailscale', `--socket=${SOCKET}`, 'set', `--ssh=${String(on)}`])
  if (r.code !== 0) throw new Error(`tailscale set --ssh=${String(on)} failed: ${r.stderr}`)
}

/** What tailscaled says about itself, for a failure message: its prefs, its status and its log's tail. */
export async function tailnetDiagnostics(bed: Bed): Promise<string> {
  const prefs = await bed.exec(['tailscale', `--socket=${SOCKET}`, 'debug', 'prefs'])
  const status = await bed.exec(['tailscale', `--socket=${SOCKET}`, 'status'])
  const log = await bed.exec(['tail', '-n', '40', '/var/log/tailscaled.log'])
  return `prefs: ${prefs.stdout.slice(0, 1500)}\nstatus: ${status.stdout}${status.stderr}\nlog:\n${log.stdout}`
}

/** Logs the node out, which removes an ephemeral node from the tailnet at once. Never throws. */
export async function leaveTailnet(bed: Bed): Promise<void> {
  await bed.exec(['tailscale', `--socket=${SOCKET}`, 'logout'])
}

/** Whether this Mac sees `hostName` as an online peer. */
export async function macSeesPeer(hostName: string): Promise<boolean> {
  const r = await macTailscale(['status', '--json'])
  try {
    const peers = Object.values((JSON.parse(r.stdout) as { Peer?: Record<string, { HostName?: string; Online?: boolean }> }).Peer ?? {})
    return peers.some((p) => p.HostName === hostName && p.Online === true)
  } catch {
    return false
  }
}
