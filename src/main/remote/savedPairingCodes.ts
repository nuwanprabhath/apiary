import { isRecord } from '@shared/guards'
import { JsonStore } from '../fs/jsonStore'

/** Electron's `safeStorage`, as much of it as this needs. */
export interface CodeCipher {
  available(): boolean
  encrypt(text: string): string
  decrypt(encrypted: string): string
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
  get canSave(): boolean { return this.cipher?.available() === true }

  /** The saved code for `host`, or null (none, or it can no longer be decrypted: it is then dropped). */
  get(host: string): string | null {
    const encrypted = this.codes.get(host)
    if (encrypted === undefined || this.cipher === null || !this.cipher.available()) return null
    try {
      return this.cipher.decrypt(encrypted)
    } catch {
      this.forget(host)
      return null
    }
  }

  /** Keeps `code` for `host`; false when this machine cannot encrypt it (nothing is written). */
  save(host: string, code: string): boolean {
    if (this.cipher === null || !this.cipher.available()) return false
    this.codes.set(host, this.cipher.encrypt(code))
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
