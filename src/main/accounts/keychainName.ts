import { createHash } from 'node:crypto'

const MAIN_ITEM = 'Claude Code-credentials'

/** The macOS Keychain item Claude Code keeps an account's login in: the main account's has no
 *  suffix, a config folder's is suffixed with the first 8 hex of sha256 over its NFC path. */
export function keychainServiceFor(folder: string | null): string {
  if (folder === null) return MAIN_ITEM
  return `${MAIN_ITEM}-${createHash('sha256').update(folder.normalize('NFC')).digest('hex').slice(0, 8)}`
}
