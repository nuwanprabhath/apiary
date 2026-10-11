import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteHost } from '@shared/domain/remote'
import { HostDirectory, parseSshConfigHosts, parseTailscalePeers, type HostDirectoryDeps } from '../../src/main/remote/hostDirectory'

const files = (map: Record<string, string>) => (path: string): string | null => map[path] ?? null

describe('ssh config parsing', () => {
  it('lists Host aliases, follows Include relative to ~/.ssh, skips patterns, comments and any case of Host', () => {
    const read = files({
      'conf.d/work': 'Host work-box\n  HostName 10.0.0.4\n',
      'extra': 'host Alpha beta # two aliases\n',
    })
    const text = [
      '# Host commented-out',
      'Host *', '  User me',
      'Host gate-* !bad prod?',
      'HOST   Mixed-Case',
      'Include conf.d/work extra missing',
      'Host=eq-sign',
      '  Host indented',
    ].join('\n')
    expect(parseSshConfigHosts(text, read)).toEqual(['Mixed-Case', 'work-box', 'Alpha', 'beta', 'eq-sign', 'indented'])
  })

  it('stops following Include loops', () => {
    const read = (): string => 'Include loop\nHost once\n'
    expect(parseSshConfigHosts('Include loop', read).length).toBeLessThan(10)
  })
})

describe('Tailscale status', () => {
  const status = JSON.stringify({
    Self: { DNSName: 'me.tail1234.ts.net.', HostName: 'me', Online: true },
    Peer: {
      a: { DNSName: 'work-box.tail1234.ts.net.', HostName: 'work-box', Online: true },
      b: { DNSName: 'asleep.tail1234.ts.net.', HostName: 'asleep', Online: false },
      c: { DNSName: '', HostName: 'no-dns', Online: true },
    },
  })

  it('gives the online peers by DNSName without its dot, else HostName, and skips Self', () => {
    expect(parseTailscalePeers(status)).toEqual(['work-box.tail1234.ts.net', 'no-dns'])
  })

  it('gives nothing for output that is not status JSON', () => {
    expect(parseTailscalePeers('not json')).toEqual([])
  })
})

interface Rig { dir: HostDirectory; probes: string[]; release(): void; calls: { exec: string[] }; deps: HostDirectoryDeps }

function rig(over: Partial<HostDirectoryDeps> & { sshConfig?: string; probe?: (host: string) => Promise<string> } = {}): Rig {
  const home = mkdtempSync(join(tmpdir(), 'hostdir-'))
  const probes: string[] = []
  const calls = { exec: [] as string[] }
  const deps: HostDirectoryDeps = {
    file: join(home, 'remote-hosts.json'),
    homeDir: home,
    readText: over.readText ?? ((path) => (path === join(home, '.ssh', 'config') ? over.sshConfig ?? null : null)),
    exec: over.exec ?? ((file) => { calls.exec.push(file); return Promise.reject(new Error('no such file')) }),
    probeExec: over.probeExec ?? ((_f, args) => {
      const host = args[args.indexOf('--') + 1]
      probes.push(host)
      return over.probe !== undefined ? over.probe(host) : Promise.resolve('ready\n')
    }),
    sshConfig: undefined,
    now: () => Date.now(),
  }
  return { dir: new HostDirectory(deps), probes, release: () => undefined, calls, deps }
}

describe('the merged list', () => {
  it('lists recent hosts first (newest first), then ssh config, then Tailscale, without repeats', async () => {
    const tailscale = JSON.stringify({ Peer: { a: { DNSName: 'ts-box.net.', Online: true }, b: { DNSName: 'cfg-b.', Online: true } } })
    const r = rig({ sshConfig: 'Host cfg-a cfg-b\n', exec: () => Promise.resolve(tailscale) })
    r.dir.connected('old')
    r.dir.connected('cfg-a')
    const hosts = await r.dir.hosts(false)
    expect(hosts.map((h) => [h.name, h.source])).toEqual([
      ['cfg-a', 'recent'], ['old', 'recent'], ['cfg-b', 'ssh-config'], ['ts-box.net', 'tailscale'],
    ])
  })

  it('keeps at most 20, and remembers recent hosts across a restart', async () => {
    const config = Array.from({ length: 30 }, (_, i) => `Host h${String(i)}`).join('\n')
    const r = rig({ sshConfig: config })
    expect((await r.dir.hosts(false)).length).toBe(20)
    r.dir.connected('seen-before')
    const again = new HostDirectory(r.deps)
    expect(again.snapshot()[0]).toMatchObject({ name: 'seen-before', source: 'recent', status: 'unknown' })
  })

  it('lists no Tailscale hosts, and raises no error, when there is no CLI', async () => {
    const r = rig({ sshConfig: 'Host only\n' })
    expect((await r.dir.hosts(false)).map((h) => h.name)).toEqual(['only'])
    expect(r.calls.exec).toEqual(['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'])
  })
})

describe('what a probe finds', () => {
  const name = (h: RemoteHost[], n: string): RemoteHost | undefined => h.find((x) => x.name === n)

  it('maps ready, off and unreachable, with the failure as a sentence', async () => {
    const answers: Record<string, () => Promise<string>> = {
      a: () => Promise.resolve('ready\n'),
      b: () => Promise.resolve('off\n'),
      e: () => Promise.resolve('stopped\n'),
      c: () => Promise.reject(new Error('ssh: Could not resolve hostname c: nodename nor servname provided')),
      d: () => Promise.reject(new Error('timed out', { cause: { killed: true } })),
      f: () => Promise.reject(new Error('dev@f: Permission denied (publickey).')),
      g: () => Promise.reject(new Error('tailscale: tailnet policy does not permit you to SSH as user "nuwan"')),
    }
    const r = rig({ sshConfig: 'Host a b c d e f g\n', probe: (h) => answers[h]() })
    const changed = vi.fn()
    r.dir.subscribe(changed)
    expect((await r.dir.hosts(true)).every((h) => h.status === 'unknown')).toBe(true)
    await vi.waitFor(() => { expect(changed).toHaveBeenCalledTimes(7) })
    const hosts = r.dir.snapshot()
    expect(name(hosts, 'e')?.status).toBe('stopped')
    expect(name(hosts, 'a')?.status).toBe('ready')
    expect(name(hosts, 'b')?.status).toBe('off')
    expect(name(hosts, 'c')).toMatchObject({ status: 'unreachable', detail: 'No machine called c was found.' })
    expect(name(hosts, 'd')).toMatchObject({ status: 'unreachable', detail: 'd did not answer.' })
    // Reached, but refused the login: the fix is a user or a key, not the network.
    expect(name(hosts, 'f')?.status).toBe('refused')
    expect(name(hosts, 'g')).toMatchObject({ status: 'refused', detail: expect.stringContaining('type user@g') as unknown })
    expect(typeof name(hosts, 'a')?.checkedAt).toBe('number')
  })

  it('runs ssh with no prompt, a known host key and a short connect wait', async () => {
    const seen: string[][] = []
    const r = rig({ sshConfig: 'Host a\n', probeExec: (_f, args) => { seen.push(args); return Promise.resolve('ready') } })
    await r.dir.hosts(true)
    await vi.waitFor(() => { expect(seen.length).toBe(1) })
    const args = seen[0].join(' ')
    expect(args).toContain('BatchMode=yes')
    expect(args).toContain('StrictHostKeyChecking=yes')
    expect(args).toContain('ConnectTimeout=3')
    // One fixed `sh -c` word: nothing a person typed is in it, and the host stays after `--`.
    const tail = seen[0].slice(seen[0].indexOf('--'))
    expect(tail.slice(0, 2)).toEqual(['--', 'a'])
    expect(tail).toHaveLength(3)
    expect(tail[2]).toMatch(/^sh -c '[^']*'$/)
    expect(tail[2]).toContain('echo ready')
    expect(tail[2]).toContain('echo off')
    expect(tail[2]).toContain('echo stopped')
  })
})

describe('when probes run', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('probes only recent hosts in the background (10 s after start, then every 10 minutes), and every listed host when the dialog asks', async () => {
    const r = rig({ sshConfig: 'Host cfg-only\n' })
    r.dir.connected('recent-one')
    r.dir.start()
    expect(r.probes).toEqual([])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(r.probes).toEqual(['recent-one'])
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(r.probes).toEqual(['recent-one', 'recent-one'])
    expect(r.probes).not.toContain('cfg-only')
    await r.dir.hosts(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(r.probes).toContain('cfg-only')
    r.dir.dispose()
  })

  it('probes at most four hosts at a time', async () => {
    let running = 0
    let peak = 0
    const finish: Array<() => void> = []
    const config = Array.from({ length: 10 }, (_, i) => `Host h${String(i)}`).join('\n')
    const r = rig({
      sshConfig: config,
      probe: () => {
        running += 1
        peak = Math.max(peak, running)
        return new Promise<string>((resolve) => { finish.push(() => { running -= 1; resolve('ready') }) })
      },
    })
    await r.dir.hosts(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(running).toBe(4)
    while (finish.length > 0) { finish.shift()?.(); await vi.advanceTimersByTimeAsync(0) }
    expect(peak).toBe(4)
    expect(r.probes.length).toBe(10)
  })
})
