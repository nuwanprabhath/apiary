import { describe, it, expect } from 'vitest'
import { createExec, createExecWithStderr } from '../../src/main/exec/run'

describe('createExec', () => {
  it('resolves to stdout on success', async () => {
    const exec = createExec()
    const out = await exec(process.execPath, ['-e', 'process.stdout.write("hi")'], process.cwd())
    expect(out).toBe('hi')
  })

  it('throws with stderr text when the process fails and writes to stderr', async () => {
    const exec = createExec()
    await expect(exec(
      process.execPath,
      ['-e', 'process.stderr.write("boom"); process.exit(1)'],
      process.cwd(),
    )).rejects.toThrow('boom')
  })

  it('prefers stderr over stdout when both are present', async () => {
    const exec = createExec()
    await expect(exec(
      process.execPath,
      ['-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exit(1)'],
      process.cwd(),
    )).rejects.toThrow(/^err/)
  })

  it('falls back to the error message when neither stream has anything', async () => {
    const exec = createExec()
    await expect(exec('/no/such/binary-at-all', [], process.cwd())).rejects.toThrow()
  })

  it('respects an injected timeout', async () => {
    const exec = createExec({ timeoutMs: 50 })
    await expect(exec(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 5000)'],
      process.cwd(),
    )).rejects.toThrow()
  })
})

describe('createExecWithStderr', () => {
  it('resolves with stderr as well as stdout, on success', async () => {
    const exec = createExecWithStderr()
    const out = await exec(process.execPath, ['-e', 'process.stdout.write("o"); process.stderr.write("report")'], process.cwd())
    expect(out).toEqual({ stdout: 'o', stderr: 'report' })
  })

  it('throws like createExec: the message is stderr first', async () => {
    const exec = createExecWithStderr()
    await expect(exec(process.execPath, ['-e', 'process.stderr.write("boom"); process.exit(1)'], process.cwd())).rejects.toThrow('boom')
  })
})
