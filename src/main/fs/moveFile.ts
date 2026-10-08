import { copyFile, rename } from 'node:fs/promises'
import { constants } from 'node:fs'

/**
 * Moves a file Apiary does not own the content of (a Claude transcript the user drags to another
 * worktree, a downloaded installer) — not app state, so neither atomic-JSON nor versioned. It lives
 * here only so every filesystem write stays under `src/main/fs` (`apiary/no-raw-state-write`).
 *
 * A plain `rename`: it replaces an existing `to`, so a caller that must never overwrite checks
 * first. With `copyAcrossDevices`, a rename that fails with `EXDEV` (the two paths are on
 * different filesystems) falls back to an exclusive copy (`COPYFILE_EXCL`, so it still never
 * overwrites) and leaves `from` for the caller to clean up.
 */
export async function moveFile(from: string, to: string, opts: { copyAcrossDevices?: boolean } = {}): Promise<void> {
  try {
    await rename(from, to)
  } catch (e) {
    if (opts.copyAcrossDevices !== true || (e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    await copyFile(from, to, constants.COPYFILE_EXCL)
  }
}
