import { existsSync } from 'node:fs'
import { ignoreErrorsAsync } from '@shared/ignoreErrors'
import { createExec } from '../exec/run'
import { launchDetached, type LaunchSpawn } from '../exec/launchDetached'

/** Known install locations, checked in order, for platforms where `code` is not on PATH — the
 *  common case on macOS, where "Shell Command: Install 'code' command in PATH" is an opt-in menu
 *  item most people never run. */
const MAC_BUNDLE_PATH = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
const LINUX_PACKAGE_PATHS = ['/usr/share/code/bin/code', '/usr/bin/code', '/snap/bin/code']

export interface DetectVsCodeOptions {
  platform?: NodeJS.Platform
  /** Injected in tests. Returns stdout, or throws the way execFile does when the binary is missing. */
  exec?: (file: string, args: string[]) => Promise<string>
  exists?: (path: string) => boolean
}

/** MAIN-23: same wrapper the other git/exec call sites use. `code --version` takes no meaningful
 *  cwd, so `process.cwd()` is passed through unconditionally — the same as before this migration,
 *  when `run()` was called with no `cwd` option (Node's default `maxBuffer`, 1MB, is also
 *  `createExec`'s default, so neither changes). */
const execViaWrapper = createExec({ timeoutMs: 5000, scope: 'vscode-detect' })
async function codeVersionExec(file: string, args: string[]): Promise<string> {
  return execViaWrapper(file, args, process.cwd())
}

/**
 * Finds the VS Code CLI once: `code` on PATH first (works everywhere it is installed with the
 * shell command), then the platform's known bundle/package locations.
 *
 * Meant to be called once per launch and cached by the caller (`AppService` does), not on every
 * hover — a hover card must never wait on a spawn.
 */
export async function detectVsCode(options: DetectVsCodeOptions = {}): Promise<string | null> {
  const platform = options.platform ?? process.platform
  const exec = options.exec ?? codeVersionExec
  const exists = options.exists ?? existsSync

  // Not on PATH is an expected answer — fall through to the known install locations.
  const onPath = await ignoreErrorsAsync(async () => {
    await exec('code', ['--version'])
    return true
  }, 'not on PATH')
  if (onPath === true) return 'code'

  const candidates = platform === 'darwin' ? [MAC_BUNDLE_PATH] : LINUX_PACKAGE_PATHS
  for (const path of candidates) {
    if (exists(path)) return path
  }
  return null
}

export interface OpenInVsCodeOptions {
  /** Injected in tests. Same signature as `child_process.spawn`. */
  spawn?: LaunchSpawn
}

/**
 * Opens `folder` in VS Code, detached from Apiary's own process so quitting Apiary does not take
 * the editor window with it. `launchDetached` owns the no-shell argument array and the `'error'`
 * listener for a binary that has gone missing since `detectVsCode` last ran (MAIN-19).
 */
export function openInVsCode(codePath: string, folder: string, options: OpenInVsCodeOptions = {}): void {
  launchDetached(codePath, [folder], 'vscode', options.spawn)
}
