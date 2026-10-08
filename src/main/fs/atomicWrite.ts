import { openSync, writeSync, fsyncSync, closeSync, renameSync, rmSync } from 'node:fs'

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
function writeTextAtomic(file: string, text: string): void {
  const tmp = `${file}.${String(process.pid)}.tmp`
  const fd = openSync(tmp, 'w')
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
