import { isRecord } from '@shared/guards'
import { JsonStore } from '../fs/jsonStore'

/** Electron's `safeStorage`, as much of it as this needs. */
export interface CodeCipher {
  available(): Promise<boolean>
  encrypt(text: string): Promise<string>
  /** `stale` when the keychain key has rotated: the text is right, and should be encrypted again. */
  decrypt(encrypted: string): Promise<{ text: string; stale: boolean }>
}

interface CodesFile { codes: Record<string, string> }

/**
 * `remote-pairing-codes.json` (home machine): the pairing code that worked for each work machine,
 * encrypted with the OS keychain (`safeStorage`), so a later connect and every reconnect send it
 * without asking. Main process only: a code never crosses IPC back to a renderer. Where encryption
 * is unavailable nothing is saved, and the user types the code again each time.
 */
export class SavedPairingCodes {
  private readonly store: JsonStore<CodesFile>
  /** A Map, since a host name may be `__proto__`. */
  private readonly codes = new Map<string, string>()

  constructor(file: string, private readonly cipher: CodeCipher | null) {
    this.store = new JsonStore<CodesFile>({
      file,
      version: 1,
      parse: (raw) => {
        const source = isRecord(raw) && isRecord(raw.codes) ? raw.codes : {}
        return { codes: Object.fromEntries(Object.entries(source).filter((e): e is [string, string] => typeof e[1] === 'string')) }
      },
      fallback: () => ({ codes: {} }),
    })
    for (const [host, value] of Object.entries(this.store.load().codes)) this.codes.set(host, value)
  }

  /** Whether a code can be kept on this machine at all. */
  async canSave(): Promise<boolean> { return this.cipher !== null && await this.cipher.available() }

  /** The saved code for `host`, or null (none, or it can no longer be decrypted: it is then dropped). */
  async get(host: string): Promise<string | null> {
    const encrypted = this.codes.get(host)
    if (encrypted === undefined || this.cipher === null || !(await this.cipher.available())) return null
    let decrypted: { text: string; stale: boolean }
    try {
      decrypted = await this.cipher.decrypt(encrypted)
    } catch {
      this.forget(host)
      return null
    }
    if (decrypted.stale) await this.save(host, decrypted.text)
    return decrypted.text
  }

  /** Keeps `code` for `host`; false when this machine cannot encrypt it (nothing is written). */
  async save(host: string, code: string): Promise<boolean> {
    if (this.cipher === null || !(await this.cipher.available())) return false
    this.codes.set(host, await this.cipher.encrypt(code))
    this.write()
    return true
  }

  forget(host: string): void {
    if (this.codes.delete(host)) this.write()
  }

  private write(): void {
    this.store.save({ codes: Object.fromEntries(this.codes) })
  }
}
