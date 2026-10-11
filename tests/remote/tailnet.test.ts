import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { RemoteHost } from '@shared/domain/remote'
import { run, startBed, type Bed } from './harness'
import { launchHome, type HomeApp } from './homeApp'
import {
  joinTailnet, leaveTailnet, macSeesPeer, macTailscale, setTailscaleSsh, tailnetAuthKey, tailnetDiagnostics, type TailnetNode,
} from './tailnet'
import { ECHO_SERVER, launchApp } from './workApp'

// Opt-in twice over: Docker (APIARY_REMOTE_E2E) and a real tailnet (APIARY_TAILNET_E2E), joined with
// TS_AUTHKEY from the environment or .env, or by signing in at the link this prints.
// `npm run test:remote:tailnet`.
const enabled = process.env.APIARY_REMOTE_E2E === '1' && process.env.APIARY_TAILNET_E2E === '1'

/** Waits for `local` to appear, sends "ping" through it and returns what came back. */
async function roundTrip(local: string): Promise<string> {
  await vi.waitFor(() => { expect(existsSync(local)).toBe(true) }, { timeout: 20_000 })
  return new Promise<string>((done, fail) => {
    const sock = connect(local)
    sock.once('error', fail)
    sock.once('data', (d) => { sock.destroy(); done(d.toString()) })
    sock.once('connect', () => sock.write('ping'))
  })
}

describe.skipIf(!enabled)('remote access over Tailscale', () => {
  let bed: Bed
  let node: TailnetNode
  const homes: HomeApp[] = []

  /** An ssh config for every name on this tailnet, as someone at home would write it. */
  const writeConfig = (file: string, knownHosts: string): string => {
    const suffix = node.dnsName.slice(node.dnsName.indexOf('.') + 1)
    writeFileSync(join(bed.dir, file), [
      `Host *.${suffix}`,
      '  User dev',
      `  IdentityFile ${join(bed.dir, 'client_key')}`,
      '  IdentitiesOnly yes',
      `  UserKnownHostsFile ${knownHosts}`,
      '  StrictHostKeyChecking yes',
      '  BatchMode yes',
      '  ConnectTimeout 10',
      '',
    ].join('\n'))
    chmodSync(join(bed.dir, file), 0o600)
    return join(bed.dir, file)
  }
  const ssh = (config: string, args: string[]) => run('ssh', ['-F', config, node.dnsName, ...args], 60_000)

  /** The echo server's socket forwarded over `config`; returns what came back. */
  const forwardEcho = async (config: string, name: string): Promise<string> => {
    const local = join(bed.dir, `${name}.sock`)
    const tunnel = spawn('ssh', ['-F', config, '-N', '-o', 'ExitOnForwardFailure=yes', '-L', `${local}:/home/dev/.apiary/echo.sock`, node.dnsName], { stdio: 'ignore' })
    try { return await roundTrip(local) } finally { tunnel.kill('SIGKILL') }
  }

  /** A fresh home app on `config`: lists the node from Tailscale, connects, and reads the work machine's sessions. */
  const homeConnects = async (config: string, name: string): Promise<{ listed: RemoteHost | undefined; sessions: number }> => {
    const root = join(bed.dir, name)
    mkdirSync(root, { recursive: true })
    const home = await launchHome(root, config)
    homes.push(home)
    await home.page.evaluate(() => window.apiary.remoteHosts(true))
    let listed: RemoteHost | undefined
    await vi.waitFor(async () => {
      const hosts = await home.page.evaluate(() => window.apiary.remoteHosts(false))
      listed = hosts.find((h) => h.name === node.dnsName)
      expect(listed?.status, JSON.stringify(hosts)).toBe('ready')
    }, { timeout: 60_000, interval: 2000 })
    const opened = home.app.waitForEvent('window')
    await home.page.evaluate((h) => window.apiary.remoteConnect(h), node.dnsName)
    const remote = await opened
    await remote.locator('html[data-ready="true"]').waitFor({ state: 'attached' })
    const sessions = await remote.evaluate(async () => (await window.apiary.discovered()).length)
    return { listed, sessions }
  }

  beforeAll(async () => {
    const mac = await macTailscale(['status', '--json'])
    const state = mac.code === 0 ? (JSON.parse(mac.stdout) as { BackendState?: string }).BackendState : undefined
    if (state !== 'Running') throw new Error(`Tailscale is not running on this Mac (state ${String(state)}): start it and sign in first.`)
    bed = await startBed()
    node = await joinTailnet(bed, tailnetAuthKey(), (url) => {
      console.warn(`\n>>> Sign the test node in to your tailnet (it is ephemeral and leaves when the test ends):\n>>> ${url}\n`)
    })
    // The echo server for the forwarding cases, and the work app with remote access on.
    writeFileSync(join(bed.dir, 'echo.cjs'), ECHO_SERVER)
    await bed.copyIn(join(bed.dir, 'echo.cjs'), '/home/dev/echo.cjs')
    await bed.exec(['bash', '-c', 'mkdir -p /home/dev/.apiary && chmod 700 /home/dev/.apiary && chown dev:dev /home/dev/echo.cjs /home/dev/.apiary'])
    await bed.exec(['bash', '-c', 'nohup node /home/dev/echo.cjs /home/dev/.apiary/echo.sock >/dev/null 2>&1 &'], 'dev')
    await launchApp(bed, { remoteAccess: true })
    await vi.waitFor(async () => {
      expect((await bed.exec(['stat', '-c', '%a', '/home/dev/.apiary/remote.sock'])).stdout.trim()).toBe('600')
    }, { timeout: 60_000, interval: 1000 })
  })

  afterAll(async () => {
    for (const home of homes) await home.app.close().catch(() => undefined)
    // A setup that failed early (Tailscale off here, too little disk) left no bed to clean up.
    if ((bed as Bed | undefined) === undefined) return
    await run('pkill', ['-f', bed.dir])
    await leaveTailnet(bed)
    await bed.stop()
  })

  it('this Mac sees the container as an online peer', async () => {
    await vi.waitFor(async () => { expect(await macSeesPeer(node.hostName)).toBe(true) }, { timeout: 120_000, interval: 2000 })
  })

  describe("OpenSSH on the tailnet address (the container's own sshd)", () => {
    let config = ''
    beforeAll(() => {
      const pub = readFileSync(join(bed.dir, 'host_key.pub'), 'utf8').trim().split(' ').slice(0, 2).join(' ')
      writeFileSync(join(bed.dir, 'known_hosts_tailnet'), `${node.dnsName},${node.ip} ${pub}\n`)
      config = writeConfig('ssh_config_tailnet', join(bed.dir, 'known_hosts_tailnet'))
    })

    it('connects by its MagicDNS name with the pinned host key', async () => {
      const r = await ssh(config, ['hostname'])
      expect(r.code, r.stderr).toBe(0)
    })

    it('forwards a Unix socket: a message round-trips', async () => {
      expect(await forwardEcho(config, 'openssh')).toBe('ping')
    })

    it("Apiary lists the host from Tailscale, connects, and reads the work machine's session", async () => {
      const { listed, sessions } = await homeConnects(config, 'home-openssh')
      expect(listed?.source).toBe('tailscale')
      expect(sessions).toBe(1)
    })
  })

  // What the maintainer does at work: `tailscale up --ssh`. Tailscale answers port 22 on the tailnet
  // address itself, signing people in by tailnet identity and the tailnet's SSH policy, not keys.
  describe('Tailscale SSH (tailscale up --ssh)', () => {
    let config = ''
    beforeAll(async () => {
      await setTailscaleSsh(bed, true)
      // Tailscale SSH has its own host key. Learned over WireGuard, which already authenticated the peer.
      let scan = ''
      try {
        await vi.waitFor(async () => {
          const r = await run('ssh-keyscan', ['-T', '10', node.ip], 30_000)
          scan = r.stdout
          // The banner comment ("# host:22 SSH-2.0-Tailscale") is on stdout or stderr depending on
          // the OpenSSH version; until it says Tailscale, port 22 is still the container's sshd.
          expect(r.stdout + r.stderr).toMatch(/SSH-2\.0-Tailscale/)
        }, { timeout: 60_000, interval: 2000 })
      } catch (e) {
        throw new Error(`Tailscale SSH never answered on ${node.ip}:22.\n${await tailnetDiagnostics(bed)}`, { cause: e })
      }
      const lines = scan.split('\n').filter((l) => l !== '' && !l.startsWith('#'))
        .map((l) => `${node.dnsName},${node.ip} ${l.split(' ').slice(1).join(' ')}`)
      writeFileSync(join(bed.dir, 'known_hosts_tsssh'), lines.join('\n') + '\n')
      config = writeConfig('ssh_config_tsssh', join(bed.dir, 'known_hosts_tsssh'))
    })

    it('signs in as dev through the tailnet policy', async () => {
      const r = await ssh(config, ['whoami'])
      expect(r.code, r.stderr).toBe(0)
      expect(r.stdout.trim()).toBe('dev')
    })

    it('forwards a Unix socket: a message round-trips', async () => {
      expect(await forwardEcho(config, 'tsssh')).toBe('ping')
    })

    it("Apiary lists the host from Tailscale, connects, and reads the work machine's session", async () => {
      const { listed, sessions } = await homeConnects(config, 'home-tsssh')
      expect(listed?.source).toBe('tailscale')
      expect(sessions).toBe(1)
    })
  })
})
