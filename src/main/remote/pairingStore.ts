import { randomInt } from 'node:crypto'
import { isRecord } from '@shared/guards'
import { formatPairingCode, isPairingCode, normalizePairingCode, PAIRING_ALPHABET } from '@shared/domain/remote'
import { JsonStore } from '../fs/jsonStore'

interface PairingFile { code: string }

/** A fresh code: 8 characters from `PAIRING_ALPHABET`, drawn with `crypto.randomInt` (never `Math.random`). */
export function generatePairingCode(): string {
  let code = ''
  for (let i = 0; i < 8; i++) code += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)]
  return code
}

/**
 * `remote-pairing.json`: the work machine's pairing code, in the main process only. It is made on
 * first use, kept until the user asks for a new one, and handed to the renderer only for Settings to
 * show (`remotePairing`). It is never logged.
 */
export class PairingStore {
  private readonly store: JsonStore<PairingFile>
  private current: string | null = null

  /** `required` is whether "Also require a pairing code" is on (the setting), asked each time. */
  constructor(file: string, readonly required: () => boolean, private readonly generate: () => string = generatePairingCode) {
    this.store = new JsonStore<PairingFile>({
      file,
      version: 1,
      parse: (raw) => {
        const code = isRecord(raw) && typeof raw.code === 'string' ? raw.code : ''
        if (!isPairingCode(code)) throw new Error('no valid code')
        return { code: normalizePairingCode(code) }
      },
      fallback: () => ({ code: '' }),
    })
  }

  /** The code as stored (no dash), made and saved if there is none yet. */
  code(): string {
    if (this.current === null) {
      const stored = this.store.load().code
      if (stored === '') return this.regenerate()
      this.current = stored
    }
    return this.current
  }

  /** The code as shown: `XXXX-XXXX`. */
  display(): string { return formatPairingCode(this.code()) }

  /** Replaces the code; every home machine has to enter the new one. */
  regenerate(): string {
    this.current = this.generate()
    this.store.save({ code: this.current })
    return this.current
  }
}
