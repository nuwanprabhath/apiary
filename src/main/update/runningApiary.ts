import { readlinkSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { ignoreErrors } from '@shared/ignoreErrors'
import { readTextFile } from '../fs/textFile'

/** The Apiary running on this profile, as the command-line update needs it to start it again. */
export interface RunningApiary {
  pid: number
  /** Its arguments after the binary, as it was started. */
  args: string[]
  /** Its environment: where its display and session bus are, so the new one gets the same. */
  env: Record<string, string>
  /** Its `/proc/<pid>/cgroup`, for `systemdUserUnit`. */
  cgroup: string
  /**
   * Its parent's: Chromium moves its main process into a scope of its own (`app-apiary-<pid>.scope`),
   * so the unit Apiary was started in (`apiary.service`) is found on the parent, the process that
   * ran it again with no display, which stays in that unit.
   */
  parentCgroup: string
}

export interface RunningApiaryDeps {
  /** Reads the `SingletonLock` link Chromium keeps in userData: `<host>-<pid>` while it runs. */
  readLock: (path: string) => string | null
  readProc: (pid: number, file: 'cmdline' | 'environ' | 'cgroup' | 'status') => string | null
  alive: (pid: number) => boolean
  host: string
}

const realDeps: RunningApiaryDeps = {
  readLock: (path) => ignoreErrors(() => readlinkSync(path), 'no lock link means no Apiary on this profile') ?? null,
  readProc: (pid, file) => ignoreErrors(() => readTextFile(`/proc/${String(pid)}/${file}`), 'a process that is gone has no /proc entry') ?? null,
  alive: (pid) => ignoreErrors(() => { process.kill(pid, 0); return true }, 'kill -0 fails for a process that is gone') ?? false,
  host: hostname(),
}

/** `/proc`'s NUL-separated lists, without the empty entry after the last NUL. */
const nulList = (text: string): string[] => text.split('\0').filter((part) => part !== '')

/**
 * A process's words from its `/proc/<pid>/cmdline`. Chromium rewrites its main process's title, which
 * leaves the arguments joined by spaces with no NUL between them (seen on Electron 45, Ubuntu 24.04),
 * so then the words are split on spaces: an argument with a space in it cannot be told apart there.
 */
function commandLineWords(cmdline: string): string[] {
  const words = nulList(cmdline)
  return words.length === 1 ? words[0].split(' ').filter((w) => w !== '') : words
}

/**
 * The Apiary holding this profile's single-instance lock, or null when none runs. Chromium's lock is
 * a symbolic link to `<host>-<pid>`; a lock left by a crash names a pid that is gone, or another
 * machine's (a home folder shared over NFS), and neither is running here. Linux only (`/proc`).
 */
export function findRunningApiary(userData: string, deps: RunningApiaryDeps = realDeps): RunningApiary | null {
  const target = deps.readLock(join(userData, 'SingletonLock'))
  if (target === null) return null
  const match = /^(.*)-(\d+)$/.exec(target)
  if (match === null || match[1] !== deps.host) return null
  const pid = Number(match[2])
  if (!deps.alive(pid)) return null
  const cmdline = deps.readProc(pid, 'cmdline')
  if (cmdline === null) return null
  const env: Record<string, string> = {}
  for (const pair of nulList(deps.readProc(pid, 'environ') ?? '')) {
    const at = pair.indexOf('=')
    if (at > 0) env[pair.slice(0, at)] = pair.slice(at + 1)
  }
  const ppid = Number(/^PPid:\s*(\d+)/m.exec(deps.readProc(pid, 'status') ?? '')?.[1] ?? 0)
  const parentCgroup = ppid > 1 ? deps.readProc(ppid, 'cgroup') ?? '' : ''
  return { pid, args: commandLineWords(cmdline).slice(1), env, cgroup: deps.readProc(pid, 'cgroup') ?? '', parentCgroup }
}
