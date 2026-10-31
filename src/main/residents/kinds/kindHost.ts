import { delimiter } from 'node:path'
import { ensurePrivateDir, writeExecutableText, writeJsonAtomic } from '../../fs/atomicWrite'
import { readTextFile } from '../../fs/textFile'
import type { KindFiles } from './kindDeps'

/** The kinds' file access on this machine, through `main/fs`. */
export const nodeKindFiles: KindFiles = {
  ensureDir: ensurePrivateDir,
  writeExecutable: writeExecutableText,
  writeJson: writeJsonAtomic,
  readText: readTextFile,
}

/** Where Homebrew puts `glab`: an app started from the Dock does not have it on its `PATH`. */
const EXTRA_DIRS = ['/opt/homebrew/bin', '/usr/local/bin']

/** `current` with the usual tool directories after it (a directory already there is not repeated). */
export function searchPathFrom(current: string | undefined): string {
  const have = (current ?? '').split(delimiter).filter((d) => d !== '')
  return [...have, ...EXTRA_DIRS.filter((d) => !have.includes(d))].join(delimiter)
}
