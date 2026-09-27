import { writeFileSync, renameSync } from 'node:fs'

/**
 * Writes JSON to `file` via a temp file plus rename, so a crash or power loss mid-write can never
 * leave `file` truncated or invalid. Without this, `loadSettings`/`loadSessionLayout` silently fall
 * back to defaults on the next read and the file is then rewritten with those defaults on the next
 * save — the user's settings or window layout are gone. Same pattern `theme/themeStore.ts` already
 * uses. The temp name includes the pid so two processes writing the same file cannot collide.
 */
export function writeJsonAtomic(file: string, data: unknown): void {
  const tmp = `${file}.${String(process.pid)}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2))
  renameSync(tmp, file)
}
