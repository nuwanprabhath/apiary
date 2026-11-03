import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SavedPairingCodes, type CodeCipher } from '../../src/main/remote/savedPairingCodes'

/** Reverses the text: not encryption, but a stored value that is not the code itself. */
const cipher = (available = true, prefix = 'enc:', stalePrefix?: string): CodeCipher => ({
  available: () => Promise.resolve(available),
  encrypt: (text) => Promise.resolve(`${prefix}${[...text].reverse().join('')}`),
  decrypt: (encrypted) => {
    const known = [prefix, stalePrefix].find((p) => p !== undefined && encrypted.startsWith(p))
    if (known === undefined) return Promise.reject(new Error('not ours'))
    return Promise.resolve({ text: [...encrypted.slice(known.length)].reverse().join(''), stale: known !== prefix })
  },
})

describe('SavedPairingCodes', () => {
  let dir: string
  let file: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apiary-codes-')); file = join(dir, 'remote-pairing-codes.json') })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('keeps a code per host, encrypted on disk, and reads it back in a new instance', async () => {
    const codes = new SavedPairingCodes(file, cipher())
    expect(await codes.save('work-box', 'KMNP-2345')).toBe(true)
    expect(readFileSync(file, 'utf8')).not.toContain('KMNP-2345')
    expect(await new SavedPairingCodes(file, cipher()).get('work-box')).toBe('KMNP-2345')
    expect(await codes.get('other')).toBeNull()
  })

  it('saves nothing where there is no encryption', async () => {
    const codes = new SavedPairingCodes(file, cipher(false))
    expect(await codes.canSave()).toBe(false)
    expect(await codes.save('work-box', 'KMNP-2345')).toBe(false)
    expect(existsSync(file)).toBe(false)
    expect(await codes.get('work-box')).toBeNull()
    expect(await new SavedPairingCodes(file, null).save('work-box', 'KMNP-2345')).toBe(false)
  })

  it('forgets a code, and drops one that can no longer be decrypted', async () => {
    const codes = new SavedPairingCodes(file, cipher())
    await codes.save('a', 'KMNP-2345')
    await codes.save('b', 'WXYZ-6789')
    codes.forget('a')
    expect(await new SavedPairingCodes(file, cipher()).get('a')).toBeNull()
    expect(await new SavedPairingCodes(file, cipher()).get('b')).toBe('WXYZ-6789')
    const broken: CodeCipher = { ...cipher(), decrypt: () => Promise.reject(new Error('keychain changed')) }
    expect(await new SavedPairingCodes(file, broken).get('b')).toBeNull()
    expect(await new SavedPairingCodes(file, cipher()).get('b')).toBeNull()
  })

  it('encrypts a code again when the keychain key has rotated', async () => {
    await new SavedPairingCodes(file, cipher(true, 'old:')).save('work-box', 'KMNP-2345')
    const rotated = cipher(true, 'new:', 'old:')
    expect(await new SavedPairingCodes(file, rotated).get('work-box')).toBe('KMNP-2345')
    expect(readFileSync(file, 'utf8')).toContain('new:')
    expect(readFileSync(file, 'utf8')).not.toContain('old:')
  })

  it('keeps a host named __proto__ as an ordinary key', async () => {
    const codes = new SavedPairingCodes(file, cipher())
    await codes.save('__proto__', 'KMNP-2345')
    expect(await new SavedPairingCodes(file, cipher()).get('__proto__')).toBe('KMNP-2345')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
