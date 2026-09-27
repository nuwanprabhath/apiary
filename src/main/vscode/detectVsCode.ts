import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { log } from '../log/logger'
import { createExec } from '../exec/run'

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
async function defaultExec(file: string, args: string[]): Promise<string> {
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
  const exec = options.exec ?? defaultExec
  const exists = options.exists ?? existsSync

  try {
    await exec('code', ['--version'])
    return 'code'
  } catch {
    // Not on PATH — fall through to the known install locations.
  }

  const candidates = platform === 'darwin' ? [MAC_BUNDLE_PATH] : LINUX_PACKAGE_PATHS
  for (const path of candidates) {
    if (exists(path)) return path
  }
  return null
}

export interface OpenInVsCodeOptions {
  /** Injected in tests. Same signature as `child_process.spawn`. */
  spawn?: (command: string, args: string[], options: Record<string, unknown>) => ChildProcess
}

/**
 * Opens `folder` in VS Code, detached from Apiary's own process so quitting Apiary does not take
 * the editor window with it.
 *
 * `shell: false` and an argument array (never a template string) is the whole point: a folder path
 * is not sanitized against shell metacharacters anywhere upstream of this call, and it must not
 * need to be.
 */
export function openInVsCode(codePath: string, folder: string, options: OpenInVsCodeOptions = {}): void {
  const spawn = options.spawn ?? nodeSpawn
  const child = spawn(codePath, [folder], { detached: true, stdio: 'ignore', shell: false })
  // `spawn` returns before the child process actually exists, so a missing or unexecutable binary
  // (VS Code uninstalled since `detectVsCode` last ran, a stale APIARY_CODE_PATH) surfaces here,
  // asynchronously, as an 'error' event — not as a thrown exception. With nothing listening for
  // it, that event had no listener to run on and Node re-throws it as an uncaught exception on the
  // main process (MAIN-19).
  child.on?.('error', (error: Error) => {
    log.warn('vscode', 'launch failed', { codePath, error: error.message })
  })
  child.unref?.()
}
