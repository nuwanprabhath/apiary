import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveMentionedFile } from '../../src/main/vscode/mentionedFile'

let base: string
let cwd: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'apiary-mention-'))
  cwd = join(base, 'project')
  mkdirSync(join(cwd, 'src'), { recursive: true })
  mkdirSync(join(base, 'outside'))
  writeFileSync(join(cwd, 'README.md'), 'x')
  writeFileSync(join(cwd, 'src', 'a.ts'), 'x')
  writeFileSync(join(base, 'outside', 'secret.md'), 'x')
})
afterEach(() => { rmSync(base, { recursive: true, force: true }) })

describe('resolveMentionedFile', () => {
  it('finds a file by the name written, relative to the session folder', async () => {
    expect(await resolveMentionedFile(cwd, 'README.md')).toEqual({ file: realpathSync(join(cwd, 'README.md')), line: null })
    expect(await resolveMentionedFile(cwd, './src/a.ts')).toEqual({ file: realpathSync(join(cwd, 'src/a.ts')), line: null })
  })

  it('reads a :line suffix, and a :line:column one, as the line to go to', async () => {
    expect((await resolveMentionedFile(cwd, 'src/a.ts:42'))?.line).toBe(42)
    expect((await resolveMentionedFile(cwd, 'src/a.ts:42:7'))?.line).toBe(42)
  })

  it('accepts an absolute path only when it is inside the folder', async () => {
    expect(await resolveMentionedFile(cwd, join(cwd, 'README.md'))).not.toBeNull()
    expect(await resolveMentionedFile(cwd, join(base, 'outside', 'secret.md'))).toBeNull()
    expect(await resolveMentionedFile(cwd, '/etc/hosts')).toBeNull()
  })

  it('refuses a ../ that climbs out of the folder', async () => {
    expect(await resolveMentionedFile(cwd, '../outside/secret.md')).toBeNull()
    expect(await resolveMentionedFile(cwd, 'src/../../outside/secret.md')).toBeNull()
  })

  it('refuses a symlink inside the folder that points outside it', async () => {
    symlinkSync(join(base, 'outside', 'secret.md'), join(cwd, 'link.md'))
    symlinkSync(join(base, 'outside'), join(cwd, 'dir'))
    expect(await resolveMentionedFile(cwd, 'link.md')).toBeNull()
    expect(await resolveMentionedFile(cwd, 'dir/secret.md')).toBeNull()
  })

  it('follows a symlink that stays inside the folder', async () => {
    symlinkSync(join(cwd, 'README.md'), join(cwd, 'alias.md'))
    expect((await resolveMentionedFile(cwd, 'alias.md'))?.file).toBe(realpathSync(join(cwd, 'README.md')))
  })

  it('refuses what does not exist, a folder, and text that is no path at all', async () => {
    expect(await resolveMentionedFile(cwd, 'nope.md')).toBeNull()
    expect(await resolveMentionedFile(cwd, 'src')).toBeNull()
    expect(await resolveMentionedFile(cwd, '')).toBeNull()
    expect(await resolveMentionedFile(cwd, '   ')).toBeNull()
    expect(await resolveMentionedFile(cwd, 'README.md\u0000.png')).toBeNull()
    expect(await resolveMentionedFile(cwd, `${'a/'.repeat(600)}x.md`)).toBeNull()
  })
})
