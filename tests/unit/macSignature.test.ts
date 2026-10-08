import { describe, it, expect, vi, beforeEach } from 'vitest'

const codesign = vi.fn<(file: string, args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>>()
vi.mock('electron', () => ({ app: { getAppPath: () => '/Applications/Apiary.app/Contents/Resources/app.asar' } }))
vi.mock('../../src/main/exec/run', () => ({ createExecWithStderr: () => codesign }))

const { hasDeveloperIdSignature } = await import('../../src/main/update/macSignature')

describe('hasDeveloperIdSignature', () => {
  beforeEach(() => { codesign.mockReset() })

  it('is true when the report (on stderr, even for a successful run) names a Developer ID authority', async () => {
    codesign.mockResolvedValue({ stdout: '', stderr: 'Authority=Developer ID Application: Someone (ABCDE12345)\n' })
    expect(await hasDeveloperIdSignature()).toBe(true)
    expect(codesign).toHaveBeenCalledWith('codesign', ['-dv', '--verbose=2', '/Applications/Apiary.app/Contents/Resources/app.asar'], expect.any(String))
  })

  it('is false for an ad-hoc signature', async () => {
    codesign.mockResolvedValue({ stdout: '', stderr: 'Signature=adhoc\n' })
    expect(await hasDeveloperIdSignature()).toBe(false)
  })

  it('is false when codesign fails (unsigned bundle, missing tool, timeout)', async () => {
    codesign.mockRejectedValue(new Error('code object is not signed at all'))
    expect(await hasDeveloperIdSignature()).toBe(false)
  })

  it('is true when a failing run still reported a Developer ID authority', async () => {
    codesign.mockRejectedValue(new Error('Authority=Developer ID Application: Someone\nsome warning'))
    expect(await hasDeveloperIdSignature()).toBe(true)
  })
})
