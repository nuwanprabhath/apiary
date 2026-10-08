import { createReadStream, createWriteStream } from 'node:fs'
import { errorMessage } from '@shared/errors'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { log } from '../log/logger'
import { moveFile } from '../fs/moveFile'
import { createExec } from '../exec/run'
import { join, basename } from 'node:path'
import { get } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { app, shell } from 'electron'
import electronUpdater, { type UpdateInfo } from 'electron-updater'
import type { FeedResult, OpenInstallerResult, UpdateBackend } from './updateService'
import { pickInstaller, type BackendOptions } from './installerAsset'

/**
 * The real updater, wired to electron-updater and GitHub Releases.
 *
 * electron-updater is used for two of the three jobs — asking the feed what exists, and (where the
 * platform allows it) staging and installing. The third, the assisted download, is done here by
 * hand, because electron-updater's macOS download path exists only to feed Squirrel and cannot be
 * asked for "just the .dmg, on disk, verified". It is a small amount of code: fetch the asset named
 * in the release metadata, hash it, compare to the hash the metadata gives.
 *
 * The metadata comes from `latest-mac.yml` / `latest-linux.yml`, which electron-builder generates
 * beside the installers and the release workflow uploads with them. Without those files in the
 * release, no client can tell what the newest version is — see the Releasing section of CLAUDE.md.
 */

// electron-updater ships as CommonJS; the named exports are not reachable through a bare ESM
// import specifier, so the default export is destructured instead.
const { autoUpdater } = electronUpdater

/** Follows redirects (GitHub's asset URLs always redirect to a CDN) and yields the final response. */
async function fetchStream(url: string, redirectsLeft = 5): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = get(url, { headers: { 'User-Agent': 'Apiary' } }, (response) => {
      const { statusCode, headers } = response
      if (statusCode !== undefined && statusCode >= 300 && statusCode < 400 && headers.location) {
        response.resume() // Drain, or the socket is held open until it times out.
        if (redirectsLeft === 0) { reject(new Error('Too many redirects fetching the update')); return }
        fetchStream(new URL(headers.location, url).toString(), redirectsLeft - 1).then(resolve, reject)
        return
      }
      if (statusCode !== 200) {
        response.resume()
        reject(new Error(`The download failed with HTTP ${String(statusCode)}`))
        return
      }
      resolve(response)
    })
    request.on('error', reject)
  })
}

/**
 * How long to wait for the desktop to take a downloaded installer off our hands before giving up
 * on hearing back. Long enough that a slow file manager still reports its own error, short enough
 * that the button is never permanently stuck.
 *
 * Exported so it can be driven from a test rather than duplicated as a magic number.
 */
export const OPEN_TIMEOUT_MS = 10_000

const execQuarantine = createExec({ timeoutMs: 10_000, scope: 'update' })

/**
 * Sets `com.apple.quarantine` on a verified download so Gatekeeper still evaluates it when the
 * user opens it (SEC-5, partial). `createWriteStream` does not set this flag itself, so the
 * assisted download bypassed the same check a browser download gets — the file was verified
 * against a hash served by the same release as the installer, with nothing beyond that. Signing
 * the update metadata with an offline key (the rest of SEC-5) is not done here: it needs a key
 * pair generated and kept off CI, which is release infrastructure this change does not set up.
 * Best-effort and macOS-only: a failure here must not stop the user getting a verified installer,
 * only the extra OS-level nudge to double check it.
 */
type ExecFileFn = (file: string, args: readonly string[]) => Promise<unknown>

export async function setQuarantine(path: string, run: ExecFileFn = (file, args) => execQuarantine(file, [...args], process.cwd())): Promise<void> {
  const hexTime = Math.floor(Date.now() / 1000).toString(16)
  await run('xattr', ['-w', 'com.apple.quarantine', `0081;${hexTime};Apiary;`, path])
}

/** sha512, base64 — the same encoding `file.sha512` in the feed uses — of a file already on disk. */
async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha512')
  await pipeline(createReadStream(path), hash)
  return hash.digest('base64')
}

export function createUpdateBackend(opts: BackendOptions): UpdateBackend {
  autoUpdater.autoDownload = false
  // Never install behind the user's back on quit: with `assisted` platforms in the mix, "you
  // quit the app and it changed underneath you" would be a different behaviour per platform.
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.logger = null

  /** The metadata from the last successful check, needed to download the right asset. */
  let latest: UpdateInfo | null = null
  /**
   * The sha512 a downloaded file was verified against, keyed by its final path. Consulted again in
   * `openInstaller` right before `shell.openPath` (SEC-7): the earlier check only covers the
   * moment of download, and the feed controls a path on disk that then sits there, unwatched, until
   * the user clicks Open.
   */
  const verifiedSha512ByPath = new Map<string, string>()

  return {
    async check({ allowPrerelease }): Promise<FeedResult | null> {
      autoUpdater.allowPrerelease = allowPrerelease
      const result = await autoUpdater.checkForUpdates()
      if (result === null) return null
      latest = result.updateInfo
      const notes = result.updateInfo.releaseNotes
      return {
        version: result.updateInfo.version,
        // GitHub gives the release body as a string; the array form is a Windows-only shape.
        releaseNotes: typeof notes === 'string' ? notes : null,
        releaseUrl: `https://github.com/${opts.repo}/releases/tag/v${result.updateInfo.version}`,
      }
    },

    async downloadForInstall(onProgress): Promise<void> {
      const listener = (p: { percent: number }): void => { onProgress(p.percent) }
      autoUpdater.on('download-progress', listener)
      try {
        await autoUpdater.downloadUpdate()
      } finally {
        autoUpdater.off('download-progress', listener)
      }
    },

    install(): void {
      // `isSilent: false, isForceRunAfter: true` — show the installer's own UI where it has one,
      // and come back up afterwards rather than leaving the user staring at a closed app.
      autoUpdater.quitAndInstall(false, true)
    },

    async downloadInstaller(onProgress): Promise<string> {
      if (latest === null) throw new Error('No update has been found to download')
      const file = pickInstaller(latest.files, opts.platform, opts.arch)
      if (file === null) {
        throw new Error(`Release ${latest.version} has no installer for ${opts.platform} ${opts.arch}`)
      }

      const dir = opts.downloadDir ?? app.getPath('downloads')
      await mkdir(dir, { recursive: true })
      // `basename` rather than trusting the decoded string directly (SEC-7): the feed's `url` is
      // remote data, and a name of `..%2F..%2FLibrary%2Fx.dmg` would otherwise escape `dir`
      // entirely. A name that needed stripping down to get here is refused outright rather than
      // silently corrected — the feed described a path, not a filename, and downloading it
      // anywhere is the wrong response to that.
      const decoded = decodeURIComponent(file.url.split('/').pop() ?? `Apiary-${latest.version}`)
      const name = basename(decoded)
      if (name === '' || name !== decoded || name.startsWith('.')) {
        throw new Error('The release metadata named an installer file that is not a plain filename')
      }
      const target = join(dir, name)

      // Downloaded into a private temporary directory first, and only moved into `dir` once
      // verified (SEC-7): the file that is opened later should be provably the file that was
      // hashed, not a target path that anything else on the machine could have raced to fill or
      // replace between the write and the check. `wx` refuses to follow a symlink or overwrite an
      // existing entry left at the temp path by anything else.
      const tmpDir = await mkdtemp(join(app.getPath('temp'), 'apiary-update-'))
      const tmpTarget = join(tmpDir, name)
      try {
        const url = `https://github.com/${opts.repo}/releases/download/v${latest.version}/${file.url}`
        const response = await fetchStream(url)
        const total = file.size ?? Number(response.headers['content-length'] ?? 0)
        const hash = createHash('sha512')
        let received = 0

        await new Promise<void>((resolve, reject) => {
          const out = createWriteStream(tmpTarget, { flags: 'wx', mode: 0o600 })
          response.on('data', (chunk: Buffer) => {
            hash.update(chunk)
            received += chunk.length
            if (total > 0) onProgress((received / total) * 100)
          })
          response.on('error', reject)
          out.on('error', reject)
          out.on('finish', resolve)
          response.pipe(out)
        })

        const digest = hash.digest('base64')
        if (digest !== file.sha512) {
          throw new Error('The downloaded file did not match the checksum in the release, so it was discarded')
        }
        // Nothing else should be able to produce a zero-length "verified" file, but the cost of
        // being sure is one stat.
        if ((await stat(tmpTarget)).size === 0) throw new Error('The download was empty')

        // A previous attempt's leftovers would otherwise be appended to or block the rename,
        // failing for a reason nobody would guess from the message.
        await rm(target, { force: true })
        // EXDEV: the temp directory and Downloads can be on different filesystems, so a rename
        // cannot work; the copy fallback keeps the same "never overwrite" guarantee (`target` has
        // just been cleared of its own leftovers).
        await moveFile(tmpTarget, target, { copyAcrossDevices: true })
      } finally {
        // The temp copy is either moved (rename) or copied-then-orphaned (copyFile), so this
        // always has something to clean up on the success path too, on top of any failed attempt.
        await rm(tmpDir, { recursive: true, force: true })
      }

      if (opts.platform === 'darwin') {
        await setQuarantine(target).catch((e: unknown) => {
          log.warn('update', 'could not set quarantine on downloaded installer', { path: target, error: String(e) })
        })
      }

      verifiedSha512ByPath.set(target, file.sha512)
      return target
    },

    async openInstaller(path: string, action: 'open' | 'reveal'): Promise<OpenInstallerResult> {
      // Bounded, because `shell.openPath` waits for the program it launched to *exit*. Where the
      // desktop hands the file to something long-lived, that is a promise that settles when the
      // user closes an unrelated window — and an `ipcMain.handle` that never returns is an
      // `invoke` that never resolves, which the renderer eventually reports as "reply was never
      // sent": an Electron message about our plumbing, in front of a user who only wanted their
      // installer. Measured on Ubuntu 24.04: with `gio` present this returns in ~10ms even when
      // the handler stays open, so the bound is for the cases that are not that one.
      const settle = <T>(promise: Promise<T>, fallback: T): Promise<T> => Promise.race([
        promise,
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), OPEN_TIMEOUT_MS)),
      ])

      const reveal = (): OpenInstallerResult => {
        try {
          shell.showItemInFolder(path)
          return { ok: 'revealed' }
        } catch (e) {
          const reason = errorMessage(e)
          log.warn('update', 'could not reveal installer', { path, error: reason })
          return { ok: 'failed', reason }
        }
      }

      // `reveal` is not a fallback here, it is the answer — and not for the reason first
      // assumed. Measured on Ubuntu 24.04 in Docker: with no handler registered, `openPath`
      // fails fast ("A required tool could not be found", xdg-open's exit 3); with a handler and
      // `gio` present, as on a real GNOME desktop, it succeeds in ~10ms and launches it. Neither
      // outcome installs anything, because installing a `.deb` needs root and no desktop app can
      // do it for you. So handing the file over is the wrong gesture whatever the desktop does:
      // show the user where it is and give them the command instead (see `installInstructions`).
      if (action === 'reveal') {
        log.info('update', 'revealing installer', { path, action })
        return reveal()
      }

      // Re-checked right before the file is opened, not just at the moment it finished downloading
      // (SEC-7): the verified file sits in Downloads, unwatched, for however long the user takes
      // to click Open, and the only integrity check so far covered the moment of download, not the
      // moment of use. Only applies to a path this same backend instance verified — an unknown
      // path (nothing recorded for it, for instance a fresh process) is opened as before rather
      // than refused for a check that was never possible to make.
      const expected = verifiedSha512ByPath.get(path)
      if (expected !== undefined) {
        const current = await hashFile(path).catch((e: unknown) => {
          log.warn('update', 'could not re-hash installer before opening', { path, error: String(e) })
          return null
        })
        if (current !== expected) {
          log.warn('update', 'installer changed since it was verified, refusing to open it', { path })
          return { ok: 'failed', reason: 'The downloaded file changed since it was verified, so it was not opened.' }
        }
      }

      // Every branch below is logged, because this is the call that produced a bug nobody could
      // reproduce: what the desktop did with the file is the one fact that was missing.
      log.info('update', 'opening installer', { path, action })
      const started = Date.now()
      const TIMED_OUT = Symbol('timed out')
      const outcome = await settle<string | typeof TIMED_OUT>(shell.openPath(path), TIMED_OUT)
      const timedOut = outcome === TIMED_OUT
      const error = timedOut ? '' : outcome
      log.info('update', 'openPath returned', {
        ms: Date.now() - started, error: error === '' ? null : error, timedOut,
      })

      // A timeout means the opener is still running, which is not the same thing as it having
      // launched — the caller cannot tell the difference from here, so it is reported the same
      // way a deliberate `reveal` is: shown, not claimed to have opened.
      if (!timedOut && error === '') return { ok: 'opened' }
      if (!timedOut) log.warn('update', 'could not open installer, revealing instead', { path, error })
      return reveal()
    },
  }
}
