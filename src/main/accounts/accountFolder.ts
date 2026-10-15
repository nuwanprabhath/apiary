import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmdirSync, symlinkSync, unlinkSync, type Stats } from 'node:fs'
import { join } from 'node:path'
import { errorMessage } from '@shared/errors'
import type { ExecFn } from '../exec/run'
import { keychainServiceFor } from './keychainName'

/** What an account folder shares with the main config root: history, settings and extensions. */
export const SHARED_ITEMS = ['projects', 'history.jsonl', 'settings.json', 'keybindings.json', 'CLAUDE.md',
  'skills', 'commands', 'agents', 'hooks', 'plugins'] as const

function lstatSafe(path: string): Stats | null {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}

/**
 * Makes `folder` an account folder: every shared item is a symlink to the same name under
 * `mainRoot`. A link to somewhere else is replaced; a real file or directory at a link path is
 * moved aside (never deleted). A target that does not exist is skipped, except `projects`, which is
 * created so the sessions of every account land in one place. Mode 0700: it holds a login.
 */
export function ensureAccountLinks(folder: string, mainRoot: string, now = Date.now()): void {
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  for (const name of SHARED_ITEMS) {
    const target = join(mainRoot, name)
    const at = join(folder, name)
    if (!existsSync(target)) {
      if (name !== 'projects') continue
      mkdirSync(target, { recursive: true })
    }
    const st = lstatSafe(at)
    if (st?.isSymbolicLink()) {
      if (readlinkSync(at) === target) continue
      unlinkSync(at)
    } else if (st !== null) {
      renameSync(at, `${at}.apiary-moved-${String(now)}`)
    }
    symlinkSync(target, at)
  }
}

/** Deletes `dir`'s contents with `lstat`: a symlink is unlinked, never followed, so a link target
 *  (the main account's history) is untouched. */
function removeTree(path: string): void {
  const st = lstatSafe(path)
  if (st === null) return
  if (!st.isDirectory()) {
    unlinkSync(path)
    return
  }
  for (const entry of readdirSync(path)) removeTree(join(path, entry))
  rmdirSync(path)
}

/** `security` fails with "…could not be found in the keychain." when the item is not there, which
 *  is the state we want anyway. `createExec` throws the command's stderr as the message. */
function isNotFound(e: unknown): boolean {
  return /could not be found/i.test(errorMessage(e))
}

/**
 * Removes an account's folder and, on macOS, its Keychain item. Never follows a symlink, so the
 * shared history and settings it linked to survive. A Keychain failure other than "not found"
 * is thrown after the folder is gone.
 */
export async function removeAccountFolder(folder: string, opts: { exec: ExecFn; platform: NodeJS.Platform }): Promise<void> {
  removeTree(folder)
  if (opts.platform !== 'darwin') return
  try {
    await opts.exec('security', ['delete-generic-password', '-s', keychainServiceFor(folder)], process.cwd())
  } catch (e) {
    if (!isNotFound(e)) throw e
  }
}
