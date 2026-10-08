import { readFileSync, writeFileSync } from 'node:fs'

/**
 * Plain text files the *user* chose a path for (a pet export, a pet import) — not app state. They
 * are not atomic and not versioned, so they must never be used for anything Apiary reads back on
 * its own; that goes through `JsonStore`. They live here only so every filesystem write stays under
 * `src/main/fs` (the `apiary/no-raw-state-write` allowlist).
 */
export function writeTextFile(file: string, text: string): void {
  writeFileSync(file, text)
}

export function readTextFile(file: string): string {
  return readFileSync(file, 'utf8')
}
