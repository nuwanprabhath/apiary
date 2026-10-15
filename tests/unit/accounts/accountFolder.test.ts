import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SHARED_ITEMS, ensureAccountLinks, removeAccountFolder } from '../../../src/main/accounts/accountFolder'
import { keychainServiceFor } from '../../../src/main/accounts/keychainName'

let root: string
let main: string
let folder: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'apiary-account-folder-'))
  main = join(root, 'main')
  folder = join(root, 'accounts', 'work')
  mkdirSync(main, { recursive: true })
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function populateMain(): void {
  for (const name of SHARED_ITEMS) {
    if (name.includes('.')) writeFileSync(join(main, name), 'x')
    else mkdirSync(join(main, name))
  }
}

describe('ensureAccountLinks', () => {
  it('creates every shared link pointing at the main root', () => {
    populateMain()
    ensureAccountLinks(folder, main)
    for (const name of SHARED_ITEMS) expect(readlinkSync(join(folder, name))).toBe(join(main, name))
    expect(statSync(folder).mode & 0o777).toBe(0o700)
  })

  it('replaces a link pointing elsewhere', () => {
    populateMain()
    mkdirSync(folder, { recursive: true })
    symlinkSync(join(root, 'elsewhere'), join(folder, 'skills'))
    ensureAccountLinks(folder, main)
    expect(readlinkSync(join(folder, 'skills'))).toBe(join(main, 'skills'))
  })

  it('moves a real file at a link path aside as .apiary-moved-<ts>', () => {
    populateMain()
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'settings.json'), 'mine')
    ensureAccountLinks(folder, main, 123)
    expect(readFileSync(join(folder, 'settings.json.apiary-moved-123'), 'utf8')).toBe('mine')
    expect(lstatSync(join(folder, 'settings.json')).isSymbolicLink()).toBe(true)
  })

  it('skips a missing target except projects, which it creates', () => {
    ensureAccountLinks(folder, main)
    expect(readdirSync(folder)).toEqual(['projects'])
    expect(existsSync(join(main, 'projects'))).toBe(true)
  })
})

describe('removeAccountFolder', () => {
  it('remove deletes the folder but never the link targets', async () => {
    populateMain()
    for (const name of SHARED_ITEMS) {
      if (!name.includes('.')) writeFileSync(join(main, name, 'sentinel'), 'keep')
    }
    ensureAccountLinks(folder, main)
    writeFileSync(join(folder, '.claude.json'), '{}')
    await removeAccountFolder(folder, { exec: vi.fn(), platform: 'linux' })
    expect(existsSync(folder)).toBe(false)
    expect(SHARED_ITEMS.map((name) => existsSync(join(main, name)))).toEqual(SHARED_ITEMS.map(() => true))
    const sentinels = SHARED_ITEMS.filter((name) => !name.includes('.')).map((name) => readFileSync(join(main, name, 'sentinel'), 'utf8'))
    expect(sentinels).toEqual(sentinels.map(() => 'keep'))
    expect(sentinels).toHaveLength(SHARED_ITEMS.length - 4)
  })

  it('deletes the Keychain item on darwin and treats not-found as done', async () => {
    mkdirSync(folder, { recursive: true })
    const exec = vi.fn().mockRejectedValue(new Error('security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.'))
    await removeAccountFolder(folder, { exec, platform: 'darwin' })
    expect(exec).toHaveBeenCalledWith('security', ['delete-generic-password', '-s', keychainServiceFor(folder)], expect.any(String))
  })

  it('does not touch the Keychain off darwin, and surfaces another failure', async () => {
    mkdirSync(folder, { recursive: true })
    const exec = vi.fn()
    await removeAccountFolder(folder, { exec, platform: 'linux' })
    expect(exec).not.toHaveBeenCalled()
    mkdirSync(folder, { recursive: true })
    await expect(removeAccountFolder(folder, { exec: vi.fn().mockRejectedValue(new Error('denied')), platform: 'darwin' })).rejects.toThrow('denied')
  })
})
