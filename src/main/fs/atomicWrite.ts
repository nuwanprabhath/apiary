import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from 'node:fs'

/**
 * Writes `text` to `file` via a temp file, an `fsync` of that temp file and a rename, so a crash or
 * power loss mid-write can never leave `file` truncated or invalid. Without this, a loader that
 * falls back to defaults on a bad read does so silently, and the next save rewrites the file with
 * those defaults — the user's settings or window layout are gone.
 *
 * The `fsync` matters: a rename is atomic in the namespace, but without flushing the temp file's
 * data first, a power cut right after it can leave the *new name* pointing at an empty or partial
 * file on journalling filesystems that reorder data and metadata. The directory entry itself is not
 * fsynced (Windows cannot open a directory); the worst case is then the previous file, never a
 * torn one. The temp name includes the pid so two processes writing the same file cannot collide;
 * a failed write removes its temp file and rethrows.
 */
function writeTextAtomic(file: string, text: string, mode?: number): void {
  const tmp = `${file}.${String(process.pid)}.tmp`
  const fd = openSync(tmp, 'w', mode)
  let open = true
  try {
    writeSync(fd, text)
    fsyncSync(fd)
    open = false
    closeSync(fd)
    renameSync(tmp, file)
  } catch (e) {
    if (open) closeSync(fd)
    rmSync(tmp, { force: true })
    throw e
  }
}

/** The low-level primitive under `JsonStore`: pretty-printed JSON, written with `writeTextAtomic`. */
export function writeJsonAtomic(file: string, data: unknown): void {
  writeTextAtomic(file, JSON.stringify(data, null, 2))
}

/**
 * JSON only its owner may read (mode 0600 from the moment it exists), for a file holding a secret:
 * a resident's MCP config carries its bearer token. Rewritten whole, so it is not a `JsonStore`.
 */
export function writePrivateJson(file: string, data: unknown): void {
  writeTextAtomic(file, JSON.stringify(data), 0o600)
}

/** A script Apiary writes for the user's shell to run (mode 0700 from the moment it exists), replaced whole. */
export function writeExecutableText(file: string, text: string): void {
  writeTextAtomic(file, text, 0o700)
}

/** A folder only its owner may enter (0700), made with its parents; an existing one is tightened. */
export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
}
