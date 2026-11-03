import { safeStorage } from 'electron'
import type { CodeCipher } from './savedPairingCodes'

/** Electron's `safeStorage` (the OS keychain) as a `CodeCipher`; `available()` is false on a Linux session with no keyring. */
export function safeStorageCipher(): CodeCipher {
  return {
    available: () => safeStorage.isAsyncEncryptionAvailable(),
    encrypt: async (text) => (await safeStorage.encryptStringAsync(text)).toString('base64'),
    decrypt: async (encrypted) => {
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(encrypted, 'base64'))
      return { text: result, stale: shouldReEncrypt }
    },
  }
}
