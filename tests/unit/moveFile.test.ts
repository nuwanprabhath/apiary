import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// `crossDevice` makes the rename fail the way two filesystems do; otherwise the real one runs.
const flags = vi.hoisted(() => ({ crossDevice: false }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>()
  return {
    ...actual,
    rename: async (a: string, b: string) => {
      if (flags.crossDevice) throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' })
      return actual.rename(a, b)
    },
  }
})

import { moveFile } from '../../src/main/fs/moveFile'

let dir: string
let from: string
let to: string
beforeEach(() => {
  flags.crossDevice = false
  dir = mkdtempSync(join(tmpdir(), 'apiary-movefile-'))
  from = join(dir, 'from.txt')
  to = join(dir, 'to.txt')
  writeFileSync(from, 'payload')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('moveFile', () => {
  it('renames the file', async () => {
    await moveFile(from, to)
    expect(readFileSync(to, 'utf8')).toBe('payload')
    expect(existsSync(from)).toBe(false)
  })

  it('rethrows a cross-device failure unless asked to copy', async () => {
    flags.crossDevice = true
    await expect(moveFile(from, to)).rejects.toMatchObject({ code: 'EXDEV' })
    expect(existsSync(to)).toBe(false)
  })

  it('copies across devices when asked, leaving the source for the caller', async () => {
    flags.crossDevice = true
    await moveFile(from, to, { copyAcrossDevices: true })
    expect(readFileSync(to, 'utf8')).toBe('payload')
    expect(existsSync(from)).toBe(true)
  })

  it('never overwrites on the copy fallback', async () => {
    flags.crossDevice = true
    writeFileSync(to, 'existing')
    await expect(moveFile(from, to, { copyAcrossDevices: true })).rejects.toMatchObject({ code: 'EEXIST' })
    expect(readFileSync(to, 'utf8')).toBe('existing')
  })

  it('rethrows other errors even when asked to copy', async () => {
    await expect(moveFile(join(dir, 'missing'), to, { copyAcrossDevices: true })).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
