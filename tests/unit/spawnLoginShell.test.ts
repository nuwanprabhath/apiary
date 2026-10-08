import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawnLoginShell, type LoginShellSpawn } from '../../src/main/exec/spawnLoginShell'

function fakeChild(pid: number | undefined = 4321): EventEmitter & { pid: number | undefined; kill: ReturnType<typeof vi.fn> } {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), pid, kill: vi.fn(() => true),
  })
}

function harness(child = fakeChild()): { spawn: ReturnType<typeof vi.fn>; child: ReturnType<typeof fakeChild> } {
  return { spawn: vi.fn(() => child), child }
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('spawnLoginShell', () => {
  it('starts `$SHELL -l -c <command>` in cwd with the cleaned env, stdio piped', () => {
    const { spawn } = harness()
    vi.stubEnv('SHELL', '/usr/bin/zsh')
    vi.stubEnv('CLAUDECODE', '1')
    spawnLoginShell({ command: 'exec claude', cwd: '/work' }, spawn as unknown as LoginShellSpawn)
    const [file, args, options] = spawn.mock.calls[0] as unknown as [string, string[], { cwd: string; env: Record<string, string>; stdio: unknown; detached?: boolean }]
    expect(file).toBe('/usr/bin/zsh')
    expect(args).toEqual(['-l', '-c', 'exec claude'])
    expect(options.cwd).toBe('/work')
    expect(options.stdio).toEqual(['pipe', 'pipe', 'pipe'])
    expect(options.env.CLAUDECODE).toBeUndefined()
    expect(options.env.TERM).toBe('xterm-256color')
    expect(options.detached).toBeUndefined()
    vi.unstubAllEnvs()
  })

  it('passes a binary and arguments as positional parameters, detached, stdin ignored', () => {
    const { spawn } = harness()
    spawnLoginShell({ command: { bin: 'claude', flags: ['-p'], positional: ['hi'] }, cwd: '/w', shell: '/bin/sh', detached: true, stdin: 'ignore' }, spawn as unknown as LoginShellSpawn)
    const [file, args, options] = spawn.mock.calls[0] as unknown as [string, string[], { stdio: unknown; detached: boolean }]
    expect(file).toBe('/bin/sh')
    expect(args).toEqual(['-l', '-c', 'exec "$0" "$@"', 'claude', '-p', '--', 'hi'])
    expect(options.stdio).toEqual(['ignore', 'pipe', 'pipe'])
    expect(options.detached).toBe(true)
  })

  it('resolves `exited` with the code and signal when the process exits', async () => {
    const { spawn, child } = harness()
    const proc = spawnLoginShell({ command: 'x', cwd: '/w' }, spawn as unknown as LoginShellSpawn)
    child.emit('exit', 3, null)
    await expect(proc.exited).resolves.toEqual({ code: 3, signal: null })
  })

  it("settles on 'close' rather than 'exit' when asked, so stdout has drained", async () => {
    const { spawn, child } = harness()
    const proc = spawnLoginShell({ command: 'x', cwd: '/w', settleOn: 'close' }, spawn as unknown as LoginShellSpawn)
    child.emit('exit', 0, null)
    let settled = false
    void proc.exited.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    child.emit('close', 0, null)
    await expect(proc.exited).resolves.toEqual({ code: 0, signal: null })
  })

  it("resolves `exited` with the error on the child's 'error' event, and never throws it", async () => {
    const { spawn, child } = harness(fakeChild(undefined))
    const proc = spawnLoginShell({ command: 'x', cwd: '/w' }, spawn as unknown as LoginShellSpawn)
    const error = new Error('spawn /nope ENOENT')
    expect(() => child.emit('error', error)).not.toThrow()
    await expect(proc.exited).resolves.toEqual({ code: null, signal: null, error })
    // A second error (a failed kill afterwards) is swallowed too, and the first result stands.
    expect(() => child.emit('error', new Error('again'))).not.toThrow()
    await expect(proc.exited).resolves.toMatchObject({ error })
  })

  it('stop() signals the whole process group of a detached child, and resolves when it exits', async () => {
    const { spawn, child } = harness()
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const proc = spawnLoginShell({ command: 'x', cwd: '/w', detached: true }, spawn as unknown as LoginShellSpawn)
    const stopped = proc.stop()
    expect(kill).toHaveBeenCalledWith(-4321, 'SIGTERM')
    expect(child.kill).not.toHaveBeenCalled()
    child.emit('exit', null, 'SIGTERM')
    await expect(stopped).resolves.toBeUndefined()
  })

  it('stop() signals only the child when it is not a group leader', async () => {
    const { spawn, child } = harness()
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const proc = spawnLoginShell({ command: 'x', cwd: '/w' }, spawn as unknown as LoginShellSpawn)
    const stopped = proc.stop()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(kill).not.toHaveBeenCalled()
    child.emit('exit', 0, null)
    await stopped
  })

  it('falls back to the child when the group is already gone', () => {
    const { spawn, child } = harness()
    vi.spyOn(process, 'kill').mockImplementation(() => { throw new Error('ESRCH') })
    const proc = spawnLoginShell({ command: 'x', cwd: '/w', detached: true }, spawn as unknown as LoginShellSpawn)
    proc.signal()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('stop() escalates to SIGKILL after the grace period', async () => {
    vi.useFakeTimers()
    const { spawn, child } = harness()
    const proc = spawnLoginShell({ command: 'x', cwd: '/w' }, spawn as unknown as LoginShellSpawn)
    const stopped = proc.stop(1000)
    expect(child.kill).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL')
    child.emit('exit', null, 'SIGKILL')
    await stopped
  })

  it('stop() on a process that failed to start resolves without signalling', async () => {
    const { spawn, child } = harness(fakeChild(undefined))
    const proc = spawnLoginShell({ command: 'x', cwd: '/w' }, spawn as unknown as LoginShellSpawn)
    child.emit('error', new Error('ENOENT'))
    await proc.stop()
    expect(child.kill).not.toHaveBeenCalled()
  })
})
