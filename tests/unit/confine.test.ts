import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { realPathInside } from '../../src/main/fs/confine'

/** Real files, because the point is what the filesystem says a path is. */
let base: string
let root: string
let outside: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'apiary-confine-'))
  root = join(base, 'root')
  outside = join(base, 'outside')
  mkdirSync(root)
  mkdirSync(outside)
  writeFileSync(join(root, 'in.png'), 'x')
  writeFileSync(join(outside, 'secret.png'), 'x')
})
afterEach(() => { rmSync(base, { recursive: true, force: true }) })

describe('realPathInside', () => {
  it('returns the real path of a file inside the root', async () => {
    expect(await realPathInside(root, join(root, 'in.png'))).toBe(realpathSync(join(root, 'in.png')))
  })

  it('refuses a path outside the root, including one that climbs out with ..', async () => {
    expect(await realPathInside(root, join(outside, 'secret.png'))).toBeNull()
    expect(await realPathInside(root, join(root, '..', 'outside', 'secret.png'))).toBeNull()
  })

  it('refuses a sibling whose name merely starts with the root name', async () => {
    mkdirSync(join(base, 'root-evil'))
    writeFileSync(join(base, 'root-evil', 'a.png'), 'x')
    expect(await realPathInside(root, join(base, 'root-evil', 'a.png'))).toBeNull()
  })

  it('refuses a symlink inside the root that points outside it', async () => {
    symlinkSync(join(outside, 'secret.png'), join(root, 'link.png'))
    expect(await realPathInside(root, join(root, 'link.png'))).toBeNull()
  })

  it('refuses a path through a symlinked directory that points outside', async () => {
    symlinkSync(outside, join(root, 'dir'))
    expect(await realPathInside(root, join(root, 'dir', 'secret.png'))).toBeNull()
  })

  it('accepts a root that is itself reached through a symlink', async () => {
    const alias = join(base, 'alias')
    symlinkSync(root, alias)
    expect(await realPathInside(alias, join(alias, 'in.png'))).toBe(realpathSync(join(root, 'in.png')))
  })

  it('returns null for a path that does not exist', async () => {
    expect(await realPathInside(root, join(root, 'gone.png'))).toBeNull()
  })
})
