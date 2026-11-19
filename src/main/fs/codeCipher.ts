/** Electron's `safeStorage`, as much of it as a secret's keeper needs. */
export interface CodeCipher {
  available(): Promise<boolean>
  encrypt(text: string): Promise<string>
  /** `stale` when the keychain key has rotated: the text is right, and should be encrypted again. */
  decrypt(encrypted: string): Promise<{ text: string; stale: boolean }>
}
