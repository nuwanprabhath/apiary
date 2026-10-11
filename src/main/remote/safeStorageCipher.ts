import { safeStorage } from 'electron'
import type { CodeCipher } from './savedPairingCodes'

/** Electron's `safeStorage` (the OS keychain) as a `CodeCipher`; `available()` is false on a Linux session with no keyring. */
export function safeStorageCipher(): CodeCipher {
  return {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
    decrypt: (encrypted) => safeStorage.decryptString(Buffer.from(encrypted, 'base64')),
  }
}
