import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SavedPairingCodes, type CodeCipher } from '../../src/main/remote/savedPairingCodes'

/** Reverses the text: not encryption, but a stored value that is not the code itself. */
const cipher = (available = true): CodeCipher => ({
  available: () => available,
  encrypt: (text) => `enc:${[...text].reverse().join('')}`,
  decrypt: (encrypted) => {
    if (!encrypted.startsWith('enc:')) throw new Error('not ours')
    return [...encrypted.slice(4)].reverse().join('')
  },
})

describe('SavedPairingCodes', () => {
  let dir: string
  let file: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apiary-codes-')); file = join(dir, 'remote-pairing-codes.json') })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('keeps a code per host, encrypted on disk, and reads it back in a new instance', () => {
    const codes = new SavedPairingCodes(file, cipher())
    expect(codes.save('work-box', 'KMNP-2345')).toBe(true)
    expect(readFileSync(file, 'utf8')).not.toContain('KMNP-2345')
    expect(new SavedPairingCodes(file, cipher()).get('work-box')).toBe('KMNP-2345')
    expect(codes.get('other')).toBeNull()
  })

  it('saves nothing where there is no encryption', () => {
    const codes = new SavedPairingCodes(file, cipher(false))
    expect(codes.canSave).toBe(false)
    expect(codes.save('work-box', 'KMNP-2345')).toBe(false)
    expect(existsSync(file)).toBe(false)
    expect(codes.get('work-box')).toBeNull()
    expect(new SavedPairingCodes(file, null).save('work-box', 'KMNP-2345')).toBe(false)
  })

  it('forgets a code, and drops one that can no longer be decrypted', () => {
    const codes = new SavedPairingCodes(file, cipher())
    codes.save('a', 'KMNP-2345')
    codes.save('b', 'WXYZ-6789')
    codes.forget('a')
    expect(new SavedPairingCodes(file, cipher()).get('a')).toBeNull()
    expect(new SavedPairingCodes(file, cipher()).get('b')).toBe('WXYZ-6789')
    const broken: CodeCipher = { ...cipher(), decrypt: () => { throw new Error('keychain changed') } }
    expect(new SavedPairingCodes(file, broken).get('b')).toBeNull()
    expect(new SavedPairingCodes(file, cipher()).get('b')).toBeNull()
  })

  it('keeps a host named __proto__ as an ordinary key', () => {
    const codes = new SavedPairingCodes(file, cipher())
    codes.save('__proto__', 'KMNP-2345')
    expect(new SavedPairingCodes(file, cipher()).get('__proto__')).toBe('KMNP-2345')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
