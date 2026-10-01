import { createExec } from '../exec/run'

/** Runs `file args` in `cwd` and resolves with stdout. */
export type RemoteExec = (file: string, args: string[], cwd: string) => Promise<string>

/** The one way `git` is shelled out to for a folder's remote — shared by the session-bar plugin
 *  context, the MR status cache and the `!123` reference resolver (MAIN-17, MAIN-23). */
export const defaultExec: RemoteExec = createExec({
  timeoutMs: 8000, maxBuffer: 8 * 1024 * 1024, scope: 'gitlab-mr',
})

/** The `origin` remote's URL, or null when there is no remote (or no git). */
export async function originUrl(cwd: string, exec: RemoteExec = defaultExec): Promise<string | null> {
  try {
    const stdout = await exec('git', ['remote', 'get-url', 'origin'], cwd)
    const url = stdout.trim()
    return url === '' ? null : url
  } catch {
    return null
  }
}

/**
 * Resolves a folder's `origin` remote into whatever a provider makes of it (`parseGitLabRemote`,
 * a future GitHub parser), or null when there is no remote or the provider does not recognise it.
 * The ref-resolution side of the seam: code that resolves `!123`-style references asks this
 * instead of shelling out to git itself (MAIN-17).
 */
export async function resolveRemote<T>(
  cwd: string, parse: (url: string) => T | null, exec: RemoteExec = defaultExec,
): Promise<T | null> {
  const url = await originUrl(cwd, exec)
  return url === null ? null : parse(url)
}
