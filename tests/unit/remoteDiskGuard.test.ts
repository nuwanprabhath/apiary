import { describe, expect, it } from 'vitest'
import { lowDiskMessage, parseDfFreeKb, parseFreeBytesAsKb } from '../remote/diskGuard'

const DF = 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s5 239000000 172000000 34603008 84% /System/Volumes/Data\n'

describe('remote test bed disk guard', () => {
  it('reads the Available column of df -k', () => {
    expect(parseDfFreeKb(DF)).toBe(34603008)
    expect(parseDfFreeKb('garbage')).toBeUndefined()
  })
  it("reads macOS's important-usage byte count as kilobytes, and nothing else", () => {
    expect(parseFreeBytesAsKb('59573272576\n')).toBe(59573272576 / 1024)
    expect(parseFreeBytesAsKb('')).toBeUndefined()
    expect(parseFreeBytesAsKb('execution error: -1728')).toBeUndefined()
  })
  it('refuses below 15 GiB and says how much is free and what the image needs', () => {
    const msg = lowDiskMessage(10 * 1024 * 1024)
    expect(msg).toContain('10.0 GiB free')
    expect(msg).toContain('about 5 GB')
  })
  it('allows 15 GiB and above', () => {
    expect(lowDiskMessage(15 * 1024 * 1024)).toBeUndefined()
  })
})
