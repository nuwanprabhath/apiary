import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { platform, tmpdir } from 'node:os'

/**
 * Vitest's `globalSetup` for the Node projects: every temp folder a test makes goes under one root
 * for the run, removed when the run ends. Tests made `apiary-*` folders with `mkdtempSync(tmpdir())`
 * and left them: 577 of them (44 MB) after a few weeks.
 *
 * The root is in `/tmp`, not the Mac's `$TMPDIR` (49 characters long): the remote tests make Unix
 * sockets under it, and a socket path stops at 104 characters.
 */
export default function setup(): () => void {
  const root = mkdtempSync(join(platform() === 'win32' ? tmpdir() : '/tmp', 'av-'))
  process.env.TMPDIR = root
  return () => { rmSync(root, { recursive: true, force: true }) }
}
