import type { CodeCipher } from '../../src/main/fs/codeCipher'

/** A keychain stand-in: reversible, visibly not plaintext. `available: false` is a machine with no keychain. */
export function memoryCipher(o: { available?: boolean } = {}): CodeCipher {
  return {
    available: async () => o.available ?? true,
    encrypt: async (text) => `enc:${Buffer.from(text).toString('base64')}`,
    decrypt: async (encrypted) => ({ text: Buffer.from(encrypted.slice(4), 'base64').toString(), stale: false }),
  }
}
