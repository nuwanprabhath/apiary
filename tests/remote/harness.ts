import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { connect, createServer, type AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { vi } from 'vitest'
import { MAC_FREE_BYTES_JXA, lowDiskMessage, parseDfFreeKb, parseFreeBytesAsKb } from './diskGuard'

export interface Run {
  code: number | null
  stdout: string
  stderr: string
}

/** Runs a command to completion; never throws, so a test can assert on a refusal. */
export function run(file: string, args: string[], timeoutMs = 120_000): Promise<Run> {
  return new Promise((done) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err === null ? 0 : typeof err.code === 'number' ? err.code : null
      done({ code, stdout, stderr })
    })
  })
}

/** `run` with `input` written to the child's stdin. */
function runWithInput(file: string, args: string[], input: string): Promise<Run> {
  return new Promise((done) => {
    const child = execFile(file, args, { timeout: 60_000 }, (err, stdout, stderr) => {
      const code = err === null ? 0 : typeof err.code === 'number' ? err.code : null
      done({ code, stdout, stderr })
    })
    child.stdin?.end(input)
  })
}

async function must(file: string, args: string[], timeoutMs?: number): Promise<string> {
  const r = await run(file, args, timeoutMs)
  if (r.code !== 0) throw new Error(`${file} ${args.join(' ')} failed (${String(r.code)}): ${r.stderr.slice(-2000)}`)
  return r.stdout.trim()
}

const IMAGE = 'apiary-remote-test'
const REPO = resolve(import.meta.dirname, '../..')

function keygen(path: string, comment: string): Promise<string> {
  return must('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', comment, '-f', path])
}

export interface Bed {
  /** `ssh -F <config> apiary-test …args` (so the pinned host key, `BatchMode` and the key apply). */
  ssh(args: string[]): Promise<Run>
  /** The same, as a long-lived process the caller kills (a `-N -L` forward). Killed on `stop()` too. */
  sshProcess(args: string[]): ChildProcess
  /** Like `ssh`, but offering a key the container has never authorized. */
  sshWithStrangerKey(args: string[]): Promise<Run>
  /** Runs a command in the container as root through Docker, not SSH. */
  exec(args: string[], user?: string): Promise<Run>
  /** The same with `input` on its stdin: a secret goes in this way, never on a command line. */
  execWithInput(args: string[], input: string): Promise<Run>
  /** Copies a host file into the container. */
  copyIn(hostPath: string, containerPath: string): Promise<void>
  /** Restarts sshd with a different host key: the man-in-the-middle case. */
  swapHostKey(): Promise<void>
  /** A scratch directory on the host, removed by `stop()`. */
  readonly dir: string
  stop(): Promise<void>
}

/** Builds the image (cached by Docker's layers) and starts the container, key-only, on 127.0.0.1. */
export async function startBed(): Promise<Bed> {
  await must('docker', ['info'])
  // A rebuild once filled the disk (4 GB image plus cache each time): refuse before it can.
  const macFree = process.platform === 'darwin' ? parseFreeBytesAsKb((await run('osascript', ['-l', 'JavaScript', '-e', MAC_FREE_BYTES_JXA])).stdout) : undefined
  const freeKb = macFree ?? parseDfFreeKb((await run('df', ['-k', homedir()])).stdout)
  const tooLow = freeKb === undefined ? undefined : lowDiskMessage(freeKb)
  if (tooLow !== undefined) throw new Error(tooLow)
  await must('docker', ['build', '--progress=plain', '-t', IMAGE, '-f', 'tests/remote/docker/Dockerfile', REPO], 1_800_000)
  // Only this bed's own label: other projects' images on this machine are not ours to prune.
  await run('docker', ['image', 'prune', '-f', '--filter', 'label=apiary.test-bed=remote'])

  // Short path: a Unix socket path is limited to ~104 bytes on macOS.
  const dir = mkdtempSync('/tmp/apiary-remote-')
  const client = join(dir, 'client_key')
  const stranger = join(dir, 'stranger_key')
  const hostKey = join(dir, 'host_key')
  const otherHostKey = join(dir, 'other_host_key')
  await Promise.all([keygen(client, 'client'), keygen(stranger, 'stranger'), keygen(hostKey, 'host'), keygen(otherHostKey, 'mitm')])
  copyFileSync(`${client}.pub`, join(dir, 'authorized_keys'))

  const name = `apiary-remote-${String(process.pid)}-${String(Date.now())}`
  // A port chosen up front, not Docker's: a restarted container (swapHostKey) gets a new random one.
  const port = String(await freePort())
  await must('docker', ['create', '--name', name, '-p', `127.0.0.1:${port}:22`, IMAGE])
  const cp = (from: string, to: string) => must('docker', ['cp', from, `${name}:${to}`])
  await cp(hostKey, '/etc/ssh/test_host_key')
  await cp(join(dir, 'authorized_keys'), '/home/dev/.ssh/authorized_keys')
  await must('docker', ['start', name])

  const knownHosts = join(dir, 'known_hosts')
  const pub = readFileSync(`${hostKey}.pub`, 'utf8').trim().split(' ').slice(0, 2).join(' ')
  writeFileSync(knownHosts, `[127.0.0.1]:${port} ${pub}\n`)
  const config = (identity: string, path: string): string => {
    writeFileSync(path, [
      'Host apiary-test',
      '  HostName 127.0.0.1',
      `  Port ${port}`,
      '  User dev',
      `  IdentityFile ${identity}`,
      '  IdentitiesOnly yes',
      `  UserKnownHostsFile ${knownHosts}`,
      '  StrictHostKeyChecking yes',
      '  BatchMode yes',
      '  ConnectTimeout 10',
      '',
    ].join('\n'))
    chmodSync(path, 0o600)
    return path
  }
  const goodConfig = config(client, join(dir, 'ssh_config'))
  const strangerConfig = config(stranger, join(dir, 'ssh_config_stranger'))

  const children = new Set<ChildProcess>()
  const bed: Bed = {
    dir,
    ssh: (args) => run('ssh', ['-F', goodConfig, 'apiary-test', ...args]),
    sshWithStrangerKey: (args) => run('ssh', ['-F', strangerConfig, 'apiary-test', ...args]),
    sshProcess(args) {
      const child = spawn('ssh', ['-F', goodConfig, ...args, 'apiary-test'], { stdio: 'ignore' })
      children.add(child)
      child.once('exit', () => children.delete(child))
      return child
    },
    exec: (args, user = 'root') => run('docker', ['exec', '-u', user, name, ...args]),
    execWithInput: (args, input) => runWithInput('docker', ['exec', '-i', name, ...args], input),
    copyIn: async (hostPath, containerPath) => {
      await cp(hostPath, containerPath)
    },
    async swapHostKey() {
      await cp(otherHostKey, '/etc/ssh/test_host_key')
      await must('docker', ['restart', name])
      await waitForSshd(Number(port))
    },
    async stop() {
      for (const child of children) child.kill('SIGKILL')
      await run('docker', ['rm', '-f', name])
      rmSync(dir, { recursive: true, force: true })
    },
  }
  try {
    await vi.waitFor(async () => {
      const r = await bed.ssh(['true'])
      if (r.code !== 0) throw new Error(`sshd not ready: ${r.stderr}`)
    }, { timeout: 60_000, interval: 500 })
  } catch (e) {
    await bed.stop()
    throw e
  }
  return bed
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer()
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      server.close(() => { done(port) })
    })
  })
}

/** Resolves once something answers with an SSH banner on the port. */
async function waitForSshd(port: number): Promise<void> {
  await vi.waitFor(async () => {
    const banner = await new Promise<string>((done) => {
      const sock = connect(port, '127.0.0.1')
      sock.once('error', () => { done('') })
      sock.once('data', (d: Buffer) => { sock.destroy(); done(d.toString()) })
    })
    if (!banner.startsWith('SSH-')) throw new Error('sshd not up yet')
  }, { timeout: 60_000, interval: 500 })
}

/** A fixture home for the app: Claude config root with one session, and a settings.json. */
export function writeFixtureHome(root: string, settings: Record<string, unknown>): string {
  const home = join(root, 'fixture')
  mkdirSync(join(home, 'userdata'), { recursive: true })
  mkdirSync(join(home, 'projects', '-work-a'), { recursive: true })
  writeFileSync(join(home, 'fake-claude.sh'), '#!/bin/sh\nexec "${SHELL:-/bin/bash}" -l\n', { mode: 0o755 })
  const sessionId = '11111111-1111-4111-8111-111111111111'
  const base = { sessionId, cwd: '/home/dev', gitBranch: 'main', isSidechain: false, version: '2.1.246' }
  writeFileSync(join(home, 'projects', '-work-a', `${sessionId}.jsonl`), [
    { ...base, type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'hello remote' } },
    { ...base, type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n')
  writeFileSync(join(home, 'userdata', 'settings.json'), JSON.stringify({
    claudeBin: '/home/dev/fixture/fake-claude.sh',
    plugins: { 'claude-usage': false },
    ...settings,
  }))
  return home
}
