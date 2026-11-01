import { createReadStream } from 'node:fs'
import { access, mkdtemp, rm, stat, constants } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { isRecord } from '@shared/guards'
import { errorMessage } from '@shared/errors'
import { ignoreErrors, ignoreErrorsAsync } from '@shared/ignoreErrors'
import { PASSWORD_NOT_ACCEPTED, type InstallOutcome } from '@shared/domain/update'
import { log } from '../log/logger'
import { fireAndForget } from '../log/fireAndForget'
import { createExec } from '../exec/run'
import { launchDetached } from '../exec/launchDetached'
import { launchDetachedWithInput, runWithInput } from '../exec/runWithInput'
import { readTextFile } from '../fs/textFile'
import { writeExecutableText } from '../fs/atomicWrite'
import {
  SUDO_PROBE, SUDO_VALIDATE, bundleFromExecPath, debInstallCommand, isPasswordRefusal, macInstallScript,
  relaunchArgs, relaunchCommand, relaunchEnv, sudoWithStdin, systemdUserUnit,
} from './installCommands'
import type { PreviousInstall, UpdateBackend } from './updateService'

/** sha512, base64 (the encoding `file.sha512` in the feed uses), of a file already on disk. */
export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha512')
  await pipeline(createReadStream(path), hash)
  return hash.digest('base64')
}

/** The install half of a backend, shared by the real one and the test-only fake that "downloads" a real file. */
export type PlatformInstaller = Pick<UpdateBackend, 'needsPassword' | 'stillVerified' | 'installDownloaded' | 'restart' | 'takePreviousInstall'> & {
  /** Records the sha512 a download was verified against, for `stillVerified`. */
  recordVerified(path: string, sha512: string): void
}

export interface PlatformInstallerOptions {
  platform: NodeJS.Platform
  /** Where the macOS helper writes `update-result.json` for the next start. */
  resultFile: string
  /** `app.quit()`: the quit runs Apiary's normal shutdown, so ptys and layouts are saved first. */
  quit: () => void
  /** The running binary; `process.execPath` unless a test places it elsewhere. */
  execPath?: string
}

/** macOS runs a quarantined app from a read-only copy here; the helper's `mv` could never replace it. */
const TRANSLOCATED = 'Apiary is running from a quarantined copy macOS made read-only. Move Apiary.app to Applications, run `xattr -cr` on it, open it, then try again.'

/** apt can take minutes on a slow mirror or a busy dpkg lock. */
const INSTALL_TIMEOUT_MS = 10 * 60_000
const probe = createExec({ timeoutMs: 10_000, scope: 'update' })
const startUnit = createExec({ timeoutMs: 15_000, scope: 'update' })

/** The last thing a failed command said, as one line for the banner. */
function lastLine(text: string): string {
  return text.split('\n').map((l) => l.trim()).filter((l) => l !== '').pop() ?? ''
}

function parsePrevious(text: string): Omit<PreviousInstall, 'path'> & { path: unknown } | null {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value) || typeof value.version !== 'string' || typeof value.ok !== 'boolean' || typeof value.message !== 'string') return null
  return { version: value.version, ok: value.ok, message: value.message, path: value.path }
}

/**
 * Installs a verified installer and restarts into it, on Ubuntu (.deb, installed while Apiary runs)
 * and macOS (.dmg, installed by a helper after Apiary quits). The password goes to sudo's stdin and
 * nowhere else: not to argv, a file, a log line or the status.
 */
export function createPlatformInstaller(opts: PlatformInstallerOptions): PlatformInstaller {
  /** Invalidated by a successful install, which deletes the file. */
  const verifiedSha512ByPath = new Map<string, string>()
  const execPath = opts.execPath ?? process.execPath

  const sudoPassword = async (password: string | null): Promise<InstallOutcome | null> => {
    if (password === null) return null
    const result = await runWithInput(SUDO_VALIDATE.file, SUDO_VALIDATE.args, { input: `${password}\n`, timeoutMs: 30_000, scope: 'update' })
    if (result.code === 0) return null
    return isPasswordRefusal(result.code, result.stderr)
      ? { ok: false, reason: 'password', message: PASSWORD_NOT_ACCEPTED }
      : { ok: false, reason: 'install', message: lastLine(result.stderr) || 'sudo could not be run.' }
  }

  const installDeb = async (path: string, password: string | null): Promise<InstallOutcome> => {
    const cmd = debInstallCommand(path, password !== null)
    log.info('update', 'installing .deb', { path, withPassword: password !== null })
    const result = await runWithInput(cmd.file, cmd.args, { input: password === null ? '' : `${password}\n`, timeoutMs: INSTALL_TIMEOUT_MS, env: cmd.env, scope: 'update' })
    if (result.code === 0) {
      verifiedSha512ByPath.delete(path)
      await rm(path, { force: true })
      log.info('update', 'installed .deb, deleted the download', { path })
      return { ok: true }
    }
    if (isPasswordRefusal(result.code, result.stderr) && password === null) {
      log.info('update', 'sudo wants a password after all')
      return { ok: false, reason: 'password-required', message: '' }
    }
    if (isPasswordRefusal(result.code, result.stderr)) {
      log.info('update', 'sudo refused the password')
      return { ok: false, reason: 'password', message: PASSWORD_NOT_ACCEPTED }
    }
    const message = lastLine(result.stderr) || `apt-get exited with ${String(result.code)}.`
    log.warn('update', 'install failed', { code: result.code, message })
    return { ok: false, reason: 'install', message }
  }

  const installDmg = async (path: string, password: string | null, version: string): Promise<InstallOutcome> => {
    const bundle = bundleFromExecPath(execPath)
    if (bundle === null) return { ok: false, reason: 'install', message: 'Apiary is not running from an app bundle.' }
    const refused = await sudoPassword(password)
    if (refused !== null) return refused
    const dir = await mkdtemp(join(tmpdir(), 'apiary-install-'))
    const script = join(dir, 'install.sh')
    writeExecutableText(script, macInstallScript({
      pid: process.pid, dmg: path, bundle, resultFile: opts.resultFile, version, uid: process.getuid?.() ?? 501,
    }))
    if (password === null) launchDetached('/bin/sh', [script], 'update')
    else {
      const cmd = sudoWithStdin(['/bin/sh', script])
      launchDetachedWithInput(cmd.file, cmd.args, `${password}\n`, 'update')
    }
    log.info('update', 'install helper started; it installs once Apiary has quit', { bundle, withPassword: password !== null })
    return { ok: true }
  }

  const relaunchLinux = async (): Promise<void> => {
    const cgroup = ignoreErrors(() => readTextFile('/proc/self/cgroup'), 'no cgroup file means no systemd unit') ?? ''
    const command = relaunchCommand({
      pid: process.pid,
      binary: execPath,
      args: relaunchArgs(process.argv),
      env: relaunchEnv(process.env),
      unit: systemdUserUnit(cgroup),
    })
    log.info('update', 'starting the new version once this one exits', { via: command.file })
    if (command.file === 'systemd-run') await startUnit(command.file, command.args, process.cwd())
    else launchDetached(command.file, command.args, 'update')
  }

  return {
    recordVerified(path, sha512) { verifiedSha512ByPath.set(path, sha512) },

    async stillVerified(path) {
      const expected = verifiedSha512ByPath.get(path)
      if (expected === undefined) return false
      const current = await ignoreErrorsAsync(() => hashFile(path), 'a file that is gone is not verified')
      if (current !== expected) log.warn('update', 'installer changed since it was verified', { path })
      return current === expected
    },

    async needsPassword(path) {
      if (opts.platform === 'darwin') {
        if (execPath.includes('/AppTranslocation/')) throw new Error(TRANSLOCATED)
        const bundle = bundleFromExecPath(execPath)
        if (bundle === null) throw new Error('Apiary is not running from an app bundle.')
        const writable = async (p: string): Promise<boolean> => access(p, constants.W_OK).then(() => true, () => false)
        return !(await writable(bundle) && await writable(dirname(bundle)))
      }
      log.debug('update', 'asking sudo whether it needs a password', { path })
      return probe(SUDO_PROBE.file, SUDO_PROBE.args, process.cwd()).then(() => false, () => true)
    },

    async installDownloaded(path, { password, version }) {
      try {
        if (opts.platform === 'linux') return await installDeb(path, password)
        if (opts.platform === 'darwin') return await installDmg(path, password, version)
        return { ok: false, reason: 'install', message: `Apiary cannot install updates on ${opts.platform}.` }
      } catch (e) {
        log.warn('update', 'install failed', { error: errorMessage(e) })
        return { ok: false, reason: 'install', message: errorMessage(e) }
      }
    },

    restart() {
      if (opts.platform !== 'linux') { opts.quit(); return }
      // Quits even when the relaunch could not be started: the old binary's files are already replaced.
      fireAndForget(relaunchLinux().finally(opts.quit), 'update')
    },

    async takePreviousInstall() {
      const text = ignoreErrors(() => readTextFile(opts.resultFile), 'no helper ran since the last start')
      if (text === undefined) return null
      await rm(opts.resultFile, { force: true })
      const previous = ignoreErrors(() => parsePrevious(text), 'a torn result file is treated as none') ?? null
      if (previous === null) return null
      const kept = typeof previous.path === 'string' && await stat(previous.path).then((s) => s.isFile(), () => false)
      log.info('update', 'read the last install result', { ok: previous.ok, version: previous.version })
      return { ...previous, path: kept && typeof previous.path === 'string' ? previous.path : null }
    },
  }
}
