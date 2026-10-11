import { join, isAbsolute } from 'node:path'
import type { RemoteHost, RemoteHostState } from '@shared/domain/remote'
import { isRemoteHost } from '@shared/domain/remote'
import { errorMessage } from '@shared/errors'
import { isRecord } from '@shared/guards'
import { ignoreErrorsAsync } from '@shared/ignoreErrors'
import type { ExecFn } from '../exec/run'
import { JsonStore } from '../fs/jsonStore'
import { log } from '../log/logger'
import { describeSshFailure, isLoginRefused, probeArgs } from './sshCommand'

const MAX_HOSTS = 20
const MAX_CONCURRENT_PROBES = 4
const MAX_INCLUDE_DEPTH = 4
const BACKGROUND_FIRST_MS = 10_000
const BACKGROUND_EVERY_MS = 10 * 60_000
const TAILSCALE_PATHS = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale']

interface HostsFile { hosts: string[] }

/** What the last probe of one host found. */
interface Probed { status: RemoteHostState; detail?: string; checkedAt: number }

export interface HostDirectoryDeps {
  /** `remote-hosts.json`. */
  file: string
  /** The home directory `~/.ssh` is under. */
  homeDir: string
  /** Reads a text file; null when it is not there. */
  readText(path: string): string | null
  /** A short command through `main/exec` (the `tailscale` CLI). */
  exec: ExecFn
  /** `sshExec(6_000)`: the login-shell ssh with the probe's timeout. */
  probeExec: ExecFn
  /** `APIARY_SSH_CONFIG`, test-only. */
  sshConfig: string | undefined
  now(): number
}

/** Hosts mentioned by `Host` lines, without patterns. `Include` paths are followed relative to `~/.ssh`. */
export function parseSshConfigHosts(
  text: string, read: (relativeToSsh: string) => string | null, depth = 0,
): string[] {
  const hosts: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const m = /^(\w+)(?:\s*=\s*|\s+)(.*)$/.exec(line)
    if (m === null) continue
    const keyword = m[1].toLowerCase()
    const args = m[2].replace(/\s+#.*$/, '').trim().split(/\s+/).map((a) => a.replace(/^"|"$/g, '')).filter((a) => a !== '')
    if (keyword === 'host') {
      for (const a of args) if (!/[*?!]/.test(a) && isRemoteHost(a)) hosts.push(a)
    } else if (keyword === 'include' && depth < MAX_INCLUDE_DEPTH) {
      for (const a of args) {
        const included = read(a)
        if (included !== null) hosts.push(...parseSshConfigHosts(included, read, depth + 1))
      }
    }
  }
  return hosts
}

/** The online peers of `tailscale status --json`: `DNSName` without its trailing dot, else `HostName`; `Self` is skipped. */
export function parseTailscalePeers(json: string): string[] {
  let parsed: unknown
  try { parsed = JSON.parse(json) } catch { return [] }
  const peers = isRecord(parsed) && isRecord(parsed.Peer) ? Object.values(parsed.Peer) : []
  const names: string[] = []
  for (const peer of peers) {
    if (!isRecord(peer) || peer.Online !== true) continue
    const dns = typeof peer.DNSName === 'string' ? peer.DNSName.replace(/\.$/, '') : ''
    const name = dns !== '' ? dns : typeof peer.HostName === 'string' ? peer.HostName : ''
    if (isRemoteHost(name)) names.push(name)
  }
  return names
}

/** What the probe script printed; anything unexpected reads as `off` (Apiary is there, but not ready). */
function parseProbe(out: string): 'ready' | 'off' | 'stopped' {
  const word = out.trim()
  return word === 'ready' || word === 'stopped' ? word : 'off'
}

function parseHostsFile(raw: unknown): HostsFile {
  const list = isRecord(raw) && Array.isArray(raw.hosts) ? (raw.hosts as unknown[]) : []
  return { hosts: list.filter((h): h is string => typeof h === 'string' && isRemoteHost(h)).slice(0, MAX_HOSTS) }
}

/**
 * Candidate hosts for a remote connection and whether each has Apiary remote access ready. Sources,
 * in order: hosts connected to before (`remote-hosts.json`), `~/.ssh/config`, Tailscale peers.
 * Probes are one short ssh each (`probeArgs`); the cache is `probed`, invalidated by the next probe
 * of that host (the entry carries its time). Only recent hosts are probed in the background; every
 * listed host is probed when the connect dialog asks.
 */
export class HostDirectory {
  private readonly store: JsonStore<HostsFile>
  private recent: string[]
  /** Invalidated by `refreshTailscale`; empty without the CLI. */
  private peers: string[] = []
  /** Invalidated by the next probe of the same host. */
  private readonly probed = new Map<string, Probed>()
  private readonly inFlight = new Set<string>()
  private readonly queue: string[] = []
  private running = 0
  private readonly listeners = new Set<(hosts: RemoteHost[]) => void>()
  private timers: { first: ReturnType<typeof setTimeout>; every: ReturnType<typeof setInterval> } | null = null

  constructor(private readonly deps: HostDirectoryDeps) {
    this.store = new JsonStore<HostsFile>({ file: deps.file, version: 1, parse: parseHostsFile, fallback: () => ({ hosts: [] }) })
    this.recent = this.store.load().hosts
  }

  /** Probes the recent hosts 10 s from now and every 10 minutes after. Nothing else is ever probed unasked. */
  start(): void {
    if (this.timers !== null) return
    const background = (): void => { void this.refreshTailscale().then(() => { this.probe(this.recent) }) }
    this.timers = {
      first: setTimeout(background, BACKGROUND_FIRST_MS),
      every: setInterval(() => { this.probe(this.recent) }, BACKGROUND_EVERY_MS),
    }
  }

  dispose(): void {
    if (this.timers !== null) { clearTimeout(this.timers.first); clearInterval(this.timers.every); this.timers = null }
    this.listeners.clear()
    this.queue.length = 0
  }

  subscribe(listener: (hosts: RemoteHost[]) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** The list now, with what is known: recent, then ssh config, then Tailscale; deduped, at most 20. */
  snapshot(): RemoteHost[] {
    const out: RemoteHost[] = []
    const seen = new Set<string>()
    const add = (names: string[], source: RemoteHost['source']): void => {
      for (const name of names) {
        if (seen.has(name) || out.length >= MAX_HOSTS) continue
        seen.add(name)
        const p = this.probed.get(name)
        out.push({
          name, source, status: p?.status ?? 'unknown',
          ...(p?.detail !== undefined ? { detail: p.detail } : {}),
          ...(p !== undefined ? { checkedAt: p.checkedAt } : {}),
        })
      }
    }
    add(this.recent, 'recent')
    add(this.sshConfigHosts(), 'ssh-config')
    add(this.peers, 'tailscale')
    return out
  }

  /** What the connect dialog asks: the Tailscale peers are looked at again, and with `probe` every listed host is probed. */
  async hosts(probe: boolean): Promise<RemoteHost[]> {
    await this.refreshTailscale()
    if (probe) this.probe(this.snapshot().map((h) => h.name))
    return this.snapshot()
  }

  /** A connection to `host` worked: it goes first in the recent list and is known to be ready. */
  connected(host: string): void {
    this.recent = [host, ...this.recent.filter((h) => h !== host)].slice(0, MAX_HOSTS)
    try { this.store.save({ hosts: this.recent }) } catch (error) {
      log.warn('remote', 'could not save the recent hosts', { message: errorMessage(error) })
    }
    this.probed.set(host, { status: 'ready', checkedAt: this.deps.now() })
    this.emit()
  }

  /** Starts probes of `names`, at most four at a time; a host already being probed is not probed twice. */
  probe(names: string[]): void {
    for (const name of names) {
      if (this.inFlight.has(name)) continue
      this.inFlight.add(name)
      this.queue.push(name)
    }
    this.pump()
  }

  private pump(): void {
    while (this.running < MAX_CONCURRENT_PROBES && this.queue.length > 0) {
      const name = this.queue.shift()
      if (name === undefined) break
      this.running += 1
      void this.probeOne(name).then((result) => {
        this.probed.set(name, result)
        this.inFlight.delete(name)
        this.running -= 1
        this.emit()
        this.pump()
      })
    }
  }

  /** One probe now, recorded like any other; rejects with a sentence when ssh cannot get in. */
  async probeNow(host: string): Promise<'ready' | 'off' | 'stopped'> {
    const result = await this.probeOne(host)
    this.probed.set(host, result)
    this.emit()
    if (result.status === 'unreachable' || result.status === 'refused') throw new Error(result.detail)
    return parseProbe(result.status)
  }

  private async probeOne(host: string): Promise<Probed> {
    const checkedAt = this.deps.now()
    try {
      const out = await this.deps.probeExec('ssh', probeArgs(host, this.deps.sshConfig), process.cwd())
      return { status: parseProbe(out), checkedAt }
    } catch (error) {
      const killed = isRecord(error) && isRecord(error.cause) && error.cause.killed === true
      const stderr = errorMessage(error)
      return { status: !killed && isLoginRefused(stderr) ? 'refused' : 'unreachable', detail: describeSshFailure(stderr, host, killed), checkedAt }
    }
  }

  private emit(): void {
    const hosts = this.snapshot()
    for (const listener of this.listeners) listener(hosts)
  }

  private sshConfigHosts(): string[] {
    const dir = join(this.deps.homeDir, '.ssh')
    const read = (rel: string): string | null => this.deps.readText(isAbsolute(rel) ? rel : join(dir, rel))
    const main = this.deps.sshConfig !== undefined ? this.deps.readText(this.deps.sshConfig) : read('config')
    return main === null ? [] : parseSshConfigHosts(main, read)
  }

  /** No CLI (or one that fails) means no Tailscale hosts, quietly. */
  private async refreshTailscale(): Promise<void> {
    let out: string | undefined
    for (const cli of TAILSCALE_PATHS) {
      out = await ignoreErrorsAsync(() => this.deps.exec(cli, ['status', '--json'], this.deps.homeDir), 'no tailscale CLI here, or it is not running: there are no Tailscale hosts')
      if (out !== undefined) break
    }
    const peers = out === undefined ? [] : parseTailscalePeers(out)
    const changed = peers.join('\n') !== this.peers.join('\n')
    this.peers = peers
    if (changed) this.emit()
  }
}
