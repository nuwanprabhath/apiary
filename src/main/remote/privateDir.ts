import { existsSync, readFileSync } from 'node:fs'
import { ignoreErrors } from '@shared/ignoreErrors'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A new directory only this user can enter (mkdtemp makes it 0700), to hold the forwarded socket. A short name: a socket path has about 100 characters. */
export function makePrivateDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'apiary-'))
}

export async function removePrivateDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

export function pathExists(path: string): boolean {
  return existsSync(path)
}

/** A small text file (an ssh config), or null when it is not there or cannot be read. */
export function readSshConfigFile(path: string): string | null {
  return ignoreErrors(() => readFileSync(path, 'utf8'), 'a missing ssh config just lists no hosts') ?? null
}
