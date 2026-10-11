import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sshExec } from '../../src/main/remote/sshTunnel'

/**
 * `sshExec` runs ssh's short calls through the login shell, as the tunnel does. A stand-in "ssh"
 * script proves what it receives and that stdout, stderr and the timeout come back as `createExec`'s
 * callers expect.
 */
function fakeSsh(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'apiary-sshexec-'))
  const file = join(dir, 'ssh')
  writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  return file
}

describe('sshExec', () => {
  it('passes the options, then -- and the host and remote command, each as its own argument', async () => {
    const ssh = fakeSsh('for a in "$@"; do printf "[%s]" "$a"; done')
    const out = await sshExec(10_000)(ssh, ['-o', 'BatchMode=yes', '--', 'work-box', 'printf', '%s', '$HOME'], tmpdir())
    // `$HOME` arrives literally: the work machine's shell expands it, never this one.
    expect(out).toBe('[-o][BatchMode=yes][--][work-box][printf][%s][$HOME]')
  })

  it('rejects with ssh\'s stderr when it fails', async () => {
    const ssh = fakeSsh('echo "Host key verification failed." >&2; exit 255')
    await expect(sshExec(10_000)(ssh, ['--', 'work-box', 'true'], tmpdir())).rejects.toThrow('Host key verification failed.')
  })

  it('stops a call that outlives its timeout, and says it was stopped', async () => {
    const ssh = fakeSsh('exec sleep 30')
    const error = await sshExec(300)(ssh, ['--', 'work-box', 'true'], tmpdir()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error & { cause: { killed: boolean } }).cause.killed).toBe(true)
  })
})
