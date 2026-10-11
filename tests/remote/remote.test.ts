import { connect } from 'node:net'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { stays } from '../fixtures/stays'
import { encodeHandshakeFrame, FrameDecoder } from '../../src/main/remote/frames'
import {
  PROTOCOL_VERSION, contractHash, type ClientMessage,
} from '../../src/main/remote/protocol'
import type { Page } from '@playwright/test'
import { run, startBed, type Bed } from './harness'
import { ECHO_SERVER, launchApp } from './workApp'
import { launchHome, type HomeApp } from './homeApp'

/** The server refuses a hello from a different version, so the test speaks as this build. */
const APP_VERSION = (JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as { version: string }).version

// Opt-in: builds a Docker image (minutes the first time) and needs Docker. `npm run test:remote`.
const enabled = process.env.APIARY_REMOTE_E2E === '1'
if (!enabled) console.warn('tests/remote skipped: set APIARY_REMOTE_E2E=1 (npm run test:remote); it needs Docker.')

describe.skipIf(!enabled)('remote access over real SSH', () => {
  let bed: Bed

  beforeAll(async () => {
    bed = await startBed()
  })
  afterAll(async () => {
    await bed?.stop()
  })

  it('connects with the pinned host key', async () => {
    const r = await bed.ssh(['true'])
    expect(r.code, r.stderr).toBe(0)
  })

  it('refuses a client key the container never authorized', async () => {
    const r = await bed.sshWithStrangerKey(['true'])
    expect(r.code).not.toBe(0)
    expect(r.stderr).toMatch(/Permission denied/)
  })

  it('forwards a Unix socket: a message round-trips', async () => {
    const script = join(bed.dir, 'echo.cjs')
    writeFileSync(script, ECHO_SERVER)
    await bed.copyIn(script, '/home/dev/echo.cjs')
    await bed.exec(['bash', '-c', 'mkdir -p /home/dev/.apiary && chmod 700 /home/dev/.apiary && chown dev:dev /home/dev/echo.cjs /home/dev/.apiary'])
    await bed.exec(['bash', '-c', 'nohup node /home/dev/echo.cjs /home/dev/.apiary/echo.sock >/dev/null 2>&1 &'], 'dev')
    await vi.waitFor(async () => {
      const r = await bed.exec(['stat', '-c', '%a', '/home/dev/.apiary/echo.sock'])
      expect(r.stdout.trim()).toBe('600')
    }, { timeout: 15_000 })

    const local = join(bed.dir, 'fwd.sock')
    const tunnel = bed.sshProcess(['-N', '-o', 'ExitOnForwardFailure=yes', '-L', `${local}:/home/dev/.apiary/echo.sock`])
    try {
      await vi.waitFor(() => { expect(existsSync(local)).toBe(true) }, { timeout: 15_000 })
      const echoed = await new Promise<string>((done, fail) => {
        const sock = connect(local)
        sock.once('error', fail)
        sock.once('data', (d) => { sock.destroy(); done(d.toString()) })
        sock.once('connect', () => sock.write('ping'))
      })
      expect(echoed).toBe('ping')
    } finally {
      tunnel.kill('SIGKILL')
    }
  })

  it('boots Apiary headless in the container', async () => {
    await launchApp(bed, {})
    const pid = (await bed.exec(['cat', '/home/dev/app.pid'])).stdout.trim()
    await vi.waitFor(async () => {
      const log = await bed.exec(['bash', '-c', 'cat /home/dev/fixture/userdata/logs/apiary.log'])
      const out = await bed.exec(['bash', '-c',
        'grep -v dbus /home/dev/app.out | tail -c 1500; find /home/dev/fixture/userdata -maxdepth 2 | head -20; pgrep -a electron | head -3'])
      expect(log.stdout, `app output: ${out.stdout}`).toMatch(/window.*created/)
    }, { timeout: 60_000, interval: 1000 })
    await stays(async () => (await bed.exec(['kill', '-0', pid])).code === 0, 10_000, 'the app to stay alive')
  })

  // The server (src/main/remote): relaunched with `remoteAccess` on.
  describe('the remote server', () => {
    it('creates ~/.apiary/remote.sock with mode 0600', async () => {
      await bed.exec(['pkill', '-u', 'dev', '-f', 'electron'])
      // The booted app must be gone first: a second Apiary finds the first holding the
      // single-instance lock and quits at once, so a relaunch straight after pkill never listened.
      await vi.waitFor(async () => {
        expect((await bed.exec(['pgrep', '-u', 'dev', '-f', 'electron'])).code).toBe(1)
      }, { timeout: 30_000, interval: 500 })
      await launchApp(bed, { remoteAccess: true })
      await vi.waitFor(async () => {
        const r = await bed.exec(['stat', '-c', '%a', '/home/dev/.apiary/remote.sock'])
        expect(r.stdout.trim()).toBe('600')
      }, { timeout: 60_000, interval: 1000 })
    })

    it('answers a hello sent through the forwarded socket with a welcome', async () => {
      const local = join(bed.dir, 'remote.sock')
      const tunnel = bed.sshProcess(['-N', '-o', 'ExitOnForwardFailure=yes', '-L', `${local}:/home/dev/.apiary/remote.sock`])
      try {
        await vi.waitFor(() => { expect(existsSync(local)).toBe(true) }, { timeout: 15_000 })
        const hello: ClientMessage = { t: 'hello', protocol: PROTOCOL_VERSION, contract: contractHash(), appVersion: APP_VERSION }
        // The handshake is JSON (frames.ts): this test runs on the Mac's Node, whose V8 cannot read
        // the frames of the container's Electron, just as two Apiary versions could not.
        const welcome = await new Promise<unknown>((done, fail) => {
          const sock = connect(local)
          const decoder = new FrameDecoder()
          sock.once('error', fail)
          sock.on('data', (d: Buffer) => {
            const [first] = decoder.push(d)
            if (first !== undefined) { sock.destroy(); done(first) }
          })
          sock.once('connect', () => { sock.write(encodeHandshakeFrame(hello)) })
        })
        expect(welcome).toMatchObject({ t: 'welcome', appVersion: APP_VERSION })
      } finally {
        tunnel.kill('SIGKILL')
      }
    })
  })

  // This Mac's built app is the home machine, the container's app the work machine.
  describe('the whole flow: home app to work app', () => {
    let home: HomeApp | undefined
    let remote: Page
    let containerHost = ''
    const sshConfig = (): string => join(bed.dir, 'ssh_config')
    const homeSsh = (): Promise<{ code: number | null }> => run('pgrep', ['-f', sshConfig()])
    const windowCount = (): Promise<number> => home!.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    const connect = (host: string): Promise<void> => home!.page.evaluate((h) => window.apiary.remoteConnect(h), host)

    afterAll(async () => {
      await home?.app.close().catch(() => undefined)
      await run('pkill', ['-f', sshConfig()])
      await bed.exec(['pkill', '-u', 'dev', '-f', 'electron'])
    })

    it('connects and opens a second window titled for the work machine', async () => {
      containerHost = (await bed.exec(['hostname'])).stdout.trim()
      home = await launchHome(bed.dir, sshConfig())
      const opened = home.app.waitForEvent('window')
      await connect('apiary-test')
      remote = await opened
      await remote.waitForLoadState('domcontentloaded')
      expect(remote.url()).toContain('remote=')
      expect(new URL(remote.url()).searchParams.get('remote')).toBe('apiary-test')
      // The page sets its title once it has loaded (features/remote), replacing index.html's own.
      await vi.waitFor(async () => {
        const titles = await home!.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()))
        expect(titles).toContain('apiary-test — Apiary')
      }, { timeout: 15_000 })
      expect(containerHost).not.toBe('')
      expect(await windowCount()).toBe(2)
    })

    it("lists the work machine's session and opens its transcript", async () => {
      await remote.locator('html[data-ready="true"]').waitFor({ state: 'attached' })
      // Sessions are imported before they list; these calls are routed to the work machine, as in e2e's importAll.
      const found = await remote.evaluate(async () => {
        const all = await window.apiary.discovered()
        await window.apiary.importSessions(all.map((s) => s.sessionId), [])
        return JSON.stringify([all.length, (await window.apiary.tree()).length])
      })
      expect(found).toBe('[1,1]')
      // Importing does not announce a tree change, in a local window either: e2e presses Refresh
      // after importing too (tests/e2e/helpers.ts). Refresh is itself routed to the work machine.
      await remote.getByTestId('sidebar-refresh').click()
      const row = remote.locator('.sidebar').getByTestId('session-item').filter({ hasText: 'hello remote' })
      await vi.waitFor(async () => {
        expect(await row.count(), (await remote.locator('body').innerText()).slice(0, 600)).toBe(1)
      }, { timeout: 30_000 })
      expect(await home!.page.locator('.sidebar').getByText('hello remote').count()).toBe(0)
      // A change on the work machine reaches this window live: a rename broadcasts treeChanged there,
      // which crosses the connection, and the sidebar redraws with no reload.
      await remote.evaluate(async () => {
        const [session] = await window.apiary.discovered()
        if (session !== undefined) await window.apiary.renameSession(session.sessionId, 'renamed over ssh')
      })
      const renamed = remote.locator('.sidebar').getByTestId('session-item').filter({ hasText: 'renamed over ssh' })
      await vi.waitFor(async () => { expect(await renamed.count()).toBe(1) }, { timeout: 30_000 })
      await renamed.click()
      await vi.waitFor(async () => {
        const text = await remote.locator('body').innerText()
        expect(text).toContain('hello remote')
        expect(text).toMatch(/\bhi\b/)
      }, { timeout: 30_000 })
    })

    it("runs the session's shell on the work machine", async () => {
      await remote.getByTestId('shell-toggle').click()
      const term = remote.getByTestId('terminal-shell')
      await term.waitFor({ state: 'visible' })
      await term.click()
      await remote.keyboard.type('echo REMOTE_$((40+2)) $(hostname)\n')
      await vi.waitFor(async () => {
        expect(await term.innerText()).toContain(`REMOTE_42 ${containerHost}`)
      }, { timeout: 30_000 })
    })

    it('reports a disconnect when the work app stops, and leaves no ssh behind', async () => {
      await remote.evaluate(() => {
        const seen: unknown[] = []
        ;(window as unknown as { __remoteStatus: unknown[] }).__remoteStatus = seen
        window.apiary.onRemoteStatus((s) => { seen.push(s) })
      })
      expect((await homeSsh()).code).toBe(0)
      await bed.exec(['pkill', '-u', 'dev', '-f', 'electron'])
      await vi.waitFor(async () => {
        const seen = await remote.evaluate(() => (window as unknown as { __remoteStatus: Array<{ state: string }> }).__remoteStatus)
        expect(seen.some((s) => s.state === 'disconnected')).toBe(true)
      }, { timeout: 30_000 })
      await remote.close()
      await vi.waitFor(async () => { expect((await homeSsh()).code).toBe(1) }, { timeout: 30_000 })
    })

    it('refuses when the work machine is not accepting remote connections', async () => {
      // The work app is gone (stopped above), so nothing listens behind the forwarded socket.
      await expect(connect('apiary-test')).rejects.toThrow(/not accepting remote connections/)
      expect(await windowCount()).toBe(1)
    })

    it('starts the stopped work app in the background over ssh, connects, and lists its session', async () => {
      // Stopped, as above; the killed app left its socket file behind.
      await bed.exec(['rm', '-f', '/home/dev/.apiary/remote.sock'])
      const opened = home!.app.waitForEvent('window')
      await home!.page.evaluate((h) => window.apiary.remoteStartAndConnect(h), 'apiary-test')
      remote = await opened
      await remote.waitForLoadState('domcontentloaded')
      expect(new URL(remote.url()).searchParams.get('remote')).toBe('apiary-test')
      expect(await windowCount()).toBe(2)
      await remote.locator('html[data-ready="true"]').waitFor({ state: 'attached' })
      const found = await remote.evaluate(async () => JSON.stringify((await window.apiary.discovered()).length))
      expect(found).toBe('1')
      // Started with --background: the work app opened no window of its own.
      const out = await bed.exec(['sh', '-c', 'ps -u dev -o args= | grep -c -- "--background" || true'])
      expect(Number(out.stdout.trim())).toBeGreaterThan(0)
      await remote.close()
      await vi.waitFor(async () => { expect(await windowCount()).toBe(1) }, { timeout: 30_000 })
    })

    it('refuses a host that is not in the ssh config, opening no window', async () => {
      await expect(connect('no-such-host')).rejects.toThrow(/ssh|resolve|host/i)
      expect(await windowCount()).toBe(1)
    })

    it('refuses a swapped host key and never reaches the work app', async () => {
      await launchApp(bed, { remoteAccess: true })
      await vi.waitFor(async () => {
        expect((await bed.exec(['stat', '-c', '%a', '/home/dev/.apiary/remote.sock'])).stdout.trim()).toBe('600')
      }, { timeout: 60_000, interval: 1000 })
      await bed.swapHostKey()
      await expect(connect('apiary-test')).rejects.toThrow(/identity is not trusted yet, or it has changed/)
      expect(await windowCount()).toBe(1)
      const log = await bed.exec(['bash', '-c', 'cat /home/dev/fixture/userdata/logs/apiary.log'])
      expect(log.stdout).not.toMatch(/connection opened/)
    })
  })

  // Last, because it restarts sshd with a different host key and nothing after it can connect.
  it('refuses a swapped host key and runs no command (man in the middle)', async () => {
    await bed.swapHostKey()
    const r = await bed.ssh(['touch', '/home/dev/ran-marker'])
    expect(r.code).not.toBe(0)
    expect(r.stderr).toMatch(/Host key verification failed/)
    const marker = await bed.exec(['test', '-e', '/home/dev/ran-marker'])
    expect(marker.code).not.toBe(0)
  })
})
