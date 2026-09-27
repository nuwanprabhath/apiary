import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * MAIN-23: `detectVsCode`'s default `exec` now runs through `exec/run.ts`'s `createExec` instead
 * of its own `promisify(execFile)`. Every other `detectVsCode` test injects its own `exec` and so
 * never touches this default — this file mocks `node:child_process` itself (the pattern
 * `electronUpdaterBackend.test.ts` already uses) to pin the default's behaviour deterministically,
 * without depending on whether this machine happens to have `code` on PATH.
 */
const execFileMock = vi.fn<
  (file: string, args: string[], opts: unknown, cb: (e: Error | null, stdout: string, stderr: string) => void) => void
>()
vi.mock('node:child_process', () => ({
  execFile: (...args: Parameters<typeof execFileMock>) => execFileMock(...args),
  spawn: vi.fn(),
}))

const { detectVsCode } = await import('../../src/main/vscode/detectVsCode')

describe('detectVsCode default exec (MAIN-23)', () => {
  afterEach(() => vi.clearAllMocks())

  it('resolves "code" when the real execFile succeeds', async () => {
    execFileMock.mockImplementation((_file, _args, _opts, cb) => cb(null, '1.90.0\n', ''))
    expect(await detectVsCode({ platform: 'linux', exists: () => false })).toBe('code')
    expect(execFileMock).toHaveBeenCalledWith('code', ['--version'], expect.objectContaining({ timeout: 5000 }), expect.any(Function))
  })

  it('falls through to the known install paths when execFile fails, same as before the migration', async () => {
    execFileMock.mockImplementation((_file, _args, _opts, cb) => cb(new Error('command not found'), '', ''))
    expect(await detectVsCode({ platform: 'linux', exists: (p) => p === '/usr/bin/code' })).toBe('/usr/bin/code')
  })
})
