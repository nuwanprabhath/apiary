import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findMentionedFile, type MentionLookup } from '../../src/main/vscode/mentionedFile'

let base: string
let home: string
let cwd: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'apiary-mention-'))
  home = join(base, 'home')
  cwd = join(home, 'project')
  mkdirSync(join(cwd, 'src'), { recursive: true })
  mkdirSync(join(base, 'outside'))
  writeFileSync(join(cwd, 'README.md'), 'x')
  writeFileSync(join(cwd, 'src', 'a.ts'), 'x')
  writeFileSync(join(home, 'notes.md'), 'x')
  writeFileSync(join(base, 'outside', 'secret.md'), 'x')
})
afterEach(() => { rmSync(base, { recursive: true, force: true }) })

const find = (mention: string, folder = cwd): Promise<MentionLookup> => findMentionedFile({ folder, home }, mention)
const found = (path: string, line: number | null = null): MentionLookup => ({ found: { file: realpathSync(path), line } })

describe('findMentionedFile', () => {
  it('finds a file by the name written, relative to the session folder', async () => {
    expect(await find('README.md')).toEqual(found(join(cwd, 'README.md')))
    expect(await find('./src/a.ts')).toEqual(found(join(cwd, 'src/a.ts')))
  })

  it('reads a :line suffix, and a :line:column one, as the line to go to', async () => {
    expect(await find('src/a.ts:42')).toEqual(found(join(cwd, 'src/a.ts'), 42))
    expect(await find('src/a.ts:42:7')).toEqual(found(join(cwd, 'src/a.ts'), 42))
  })

  it('finds a gitignored file of a worktree session in the main checkout, where it exists', async () => {
    // A session in `.claude/worktrees/x` named `json_to_data_spec/.box-tokens.json`, which lives only
    // in the main checkout because it is gitignored.
    const worktree = join(cwd, '.claude', 'worktrees', 'x')
    mkdirSync(join(cwd, '.git', 'worktrees', 'x'), { recursive: true })
    mkdirSync(worktree, { recursive: true })
    writeFileSync(join(worktree, '.git'), `gitdir: ${join(cwd, '.git', 'worktrees', 'x')}\n`)
    mkdirSync(join(cwd, 'spec'))
    writeFileSync(join(cwd, 'spec', '.tokens.json'), 'x')
    expect(await find('spec/.tokens.json', worktree)).toEqual(found(join(cwd, 'spec', '.tokens.json')))
  })

  it('accepts a full or ~/ path anywhere in the home folder, and nowhere else', async () => {
    expect(await find(join(home, 'notes.md'))).toEqual(found(join(home, 'notes.md')))
    expect(await find('~/notes.md:3')).toEqual(found(join(home, 'notes.md'), 3))
    expect(await find(join(base, 'outside', 'secret.md'))).toEqual({ refused: 'outside' })
    expect(await find('/etc/hosts')).toEqual({ refused: 'outside' })
  })

  it('refuses a ../ that climbs out of the folder', async () => {
    expect(await find('../../outside/secret.md')).toEqual({ refused: 'outside' })
    expect(await find('src/../../../outside/secret.md')).toEqual({ refused: 'outside' })
  })

  it('refuses a symlink inside the folder that points outside the home folder', async () => {
    symlinkSync(join(base, 'outside', 'secret.md'), join(cwd, 'link.md'))
    symlinkSync(join(base, 'outside'), join(cwd, 'dir'))
    expect(await find('link.md')).toEqual({ refused: 'outside' })
    expect(await find('dir/secret.md')).toEqual({ refused: 'outside' })
  })

  it('follows a symlink that stays inside the folder', async () => {
    symlinkSync(join(cwd, 'README.md'), join(cwd, 'alias.md'))
    expect(await find('alias.md')).toEqual(found(join(cwd, 'README.md')))
  })

  it('says a named file is missing (an agent names a file before writing it), apart from text that is no path', async () => {
    expect(await find('nope.md')).toEqual({ refused: 'missing' })
    expect(await find('src')).toEqual({ refused: 'missing' })
    expect(await find('')).toEqual({ refused: 'invalid' })
    expect(await find('   ')).toEqual({ refused: 'invalid' })
    expect(await find('README.md\u0000.png')).toEqual({ refused: 'invalid' })
    expect(await find(`${'a/'.repeat(600)}x.md`)).toEqual({ refused: 'invalid' })
  })
})
