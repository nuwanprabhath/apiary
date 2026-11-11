import { createWriteStream } from 'node:fs'
import { errorMessage } from '@shared/errors'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
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
import { hashFile, type PlatformInstaller } from './platformInstaller'
import { verifyFeedSignature, servedMatchesSigned, UNVERIFIED_MESSAGE } from './releaseSignature'

/**
 * The real updater, wired to electron-updater and GitHub Releases.
 *
 * electron-updater asks the feed what exists and, where the platform allows, stages and installs.
 * The assisted download is done here by hand: electron-updater's macOS download path only feeds
 * Squirrel and cannot give "just the .dmg, on disk, verified". It fetches the asset named in the
 * release metadata, hashes it and compares to the metadata's hash.
 *
 * The metadata is `latest-mac.yml` / `latest-linux.yml`, which electron-builder generates and the
 * release workflow uploads; without them no client can tell what the newest version is.
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

async function readAll(response: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of response) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks)
}

/**
 * Fetches `latest-<platform>.yml` and its `.sig` from the release and throws unless the signature
 * verifies (a missing `.sig` is a failure too) and the verified feed names the same version and
 * the same files and hashes as `served`, electron-updater's own unverified copy.
 */
async function assertFeedSigned(repo: string, served: UpdateInfo, platform: NodeJS.Platform): Promise<void> {
  if (platform !== 'darwin' && platform !== 'linux') return
  const { version } = served
  const feedName = platform === 'darwin' ? 'latest-mac.yml' : 'latest-linux.yml'
  const base = `https://github.com/${repo}/releases/download/v${version}/${feedName}`
  const fetchOrNull = async (url: string): Promise<Buffer | null> => {
    try {
      return await readAll(await fetchStream(url))
    } catch (e) {
      log.warn('update', 'could not fetch a feed file', { url, error: errorMessage(e) })
      return null
    }
  }
  const feed = await fetchOrNull(base)
  const signature = await fetchOrNull(`${base}.sig`)
  if (feed === null || !verifyFeedSignature(feed, signature)) {
    log.warn('update', 'update feed signature missing or invalid', { version })
    throw new Error(UNVERIFIED_MESSAGE)
  }
  if (!servedMatchesSigned(feed, served)) {
    log.warn('update', 'served update feed differs from the signed one', { version })
    throw new Error(UNVERIFIED_MESSAGE)
  }
}

/**
 * How long to wait for the desktop to take a downloaded installer before giving up on hearing
 * back. Exported for tests.
 */
export const OPEN_TIMEOUT_MS = 10_000

const execQuarantine = createExec({ timeoutMs: 10_000, scope: 'update' })

/**
 * Sets `com.apple.quarantine` on a verified download so Gatekeeper still evaluates it;
 * `createWriteStream` does not set it. The feed's hash is trusted because `latest-*.yml` carries a
 * verified Ed25519 signature (`releaseSignature.ts`). Best-effort and macOS-only.
 */
type ExecFileFn = (file: string, args: readonly string[]) => Promise<unknown>

export async function setQuarantine(path: string, run: ExecFileFn = (file, args) => execQuarantine(file, [...args], process.cwd())): Promise<void> {
  const hexTime = Math.floor(Date.now() / 1000).toString(16)
  await run('xattr', ['-w', 'com.apple.quarantine', `0081;${hexTime};Apiary;`, path])
}

/** Streams a response into `target` (never following or overwriting an existing entry), reporting percent; resolves to the sha512, base64, of what was written. */
function writeHashed(
  response: IncomingMessage, target: string, total: number, onProgress: (percent: number) => void,
): Promise<string> {
  const hash = createHash('sha512')
  let received = 0
  return new Promise<string>((resolve, reject) => {
    const out = createWriteStream(target, { flags: 'wx', mode: 0o600 })
    response.on('data', (chunk: Buffer) => {
      hash.update(chunk)
      received += chunk.length
      if (total > 0) onProgress((received / total) * 100)
    })
    response.on('error', reject)
    out.on('error', reject)
    out.on('finish', () => { resolve(hash.digest('base64')) })
    response.pipe(out)
  })
}

/** `installer` does the installing for Install and restart; this backend finds and verifies what it installs. */
export function createUpdateBackend(opts: BackendOptions, installer: PlatformInstaller): UpdateBackend {
  // Never install on quit: it would behave differently per platform.
  Object.assign(autoUpdater, { autoDownload: false, autoInstallOnAppQuit: false, logger: null })
  let latest: UpdateInfo | null = null
  /** The sha512 each download was verified against, by final path; `openInstaller` re-checks it, since the file sits unwatched until Open. */
  const verifiedSha512ByPath = new Map<string, string>()

  return {
    needsPassword: (path) => installer.needsPassword(path),
    stillVerified: (path) => installer.stillVerified(path),
    installDownloaded: (path, o) => installer.installDownloaded(path, o),
    restart: () => { installer.restart() }, relaunch: () => { installer.relaunch() },
    takePreviousInstall: () => installer.takePreviousInstall(),

    async check({ allowPrerelease }): Promise<FeedResult | null> {
      autoUpdater.allowPrerelease = allowPrerelease
      const result = await autoUpdater.checkForUpdates()
      if (result === null) return null
      latest = null // set only after the signature passes: `latest.files` hashes are used later
      const { version, releaseNotes: notes } = result.updateInfo
      await assertFeedSigned(opts.repo, result.updateInfo, opts.platform)
      latest = result.updateInfo
      return {
        version,
        releaseNotes: typeof notes === 'string' ? notes : null, // the array form is Windows-only
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
      // `isSilent: false, isForceRunAfter: true`: show the installer's own UI and relaunch afterwards.
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
      // The feed's `url` is remote data: a name of `..%2F..%2FLibrary%2Fx.dmg` would escape `dir`.
      // A name that `basename` had to strip is refused, not corrected.
      const decoded = decodeURIComponent(file.url.split('/').pop() ?? `Apiary-${latest.version}`)
      const name = basename(decoded)
      if (name === '' || name !== decoded || name.startsWith('.')) {
        throw new Error('The release metadata named an installer file that is not a plain filename')
      }
      const target = join(dir, name)

      // Downloaded into a private temporary directory and moved into `dir` only once verified, so
      // nothing can race to replace the file between the write and the check. `wx` refuses to
      // follow a symlink or overwrite an existing entry at the temp path.
      const tmpDir = await mkdtemp(join(app.getPath('temp'), 'apiary-update-'))
      const tmpTarget = join(tmpDir, name)
      try {
        const url = `https://github.com/${opts.repo}/releases/download/v${latest.version}/${file.url}`
        const response = await fetchStream(url)
        const total = file.size ?? Number(response.headers['content-length'] ?? 0)
        const digest = await writeHashed(response, tmpTarget, total, onProgress)
        if (digest !== file.sha512) {
          throw new Error('The downloaded file did not match the checksum in the release, so it was discarded')
        }
        if ((await stat(tmpTarget)).size === 0) throw new Error('The download was empty')

        // A previous attempt's leftovers would block the rename.
        await rm(target, { force: true })
        // EXDEV: the temp directory and Downloads can be on different filesystems; the copy
        // fallback keeps the "never overwrite" guarantee.
        await moveFile(tmpTarget, target, { copyAcrossDevices: true })
      } finally {
        // After a copyFile the temp copy is orphaned, so the success path cleans up too.
        await rm(tmpDir, { recursive: true, force: true })
      }

      if (opts.platform === 'darwin') {
        await setQuarantine(target).catch((e: unknown) => {
          log.warn('update', 'could not set quarantine on downloaded installer', { path: target, error: String(e) })
        })
      }

      verifiedSha512ByPath.set(target, file.sha512)
      installer.recordVerified(target, file.sha512)
      return target
    },

    async openInstaller(path: string, action: 'open' | 'reveal'): Promise<OpenInstallerResult> {
      // Bounded, because `shell.openPath` waits for the launched program to *exit*: a long-lived
      // handler would leave the `invoke` unresolved and the renderer reporting "reply was never
      // sent". Measured on Ubuntu 24.04: with `gio` present it returns in ~10ms even when the
      // handler stays open.
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

      // `reveal` is the answer, not a fallback. Measured on Ubuntu 24.04 in Docker: with no handler,
      // `openPath` fails fast (xdg-open exit 3); with a handler and `gio` it succeeds in ~10ms. Neither
      // installs anything, since a `.deb` needs root, so show the file and give the command (see
      // `installInstructions`).
      if (action === 'reveal') {
        log.info('update', 'revealing installer', { path, action })
        return reveal()
      }

      // Re-checked right before opening. Only a path this backend instance verified is checked; an
      // unknown path (a fresh process) is opened as before.
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

      log.info('update', 'opening installer', { path, action })
      const started = Date.now()
      const TIMED_OUT = Symbol('timed out')
      const outcome = await settle<string | typeof TIMED_OUT>(shell.openPath(path), TIMED_OUT)
      const timedOut = outcome === TIMED_OUT
      const error = timedOut ? '' : outcome
      log.info('update', 'openPath returned', {
        ms: Date.now() - started, error: error === '' ? null : error, timedOut,
      })

      // A timeout means the opener is still running, not that it launched: reported like `reveal`.
      if (!timedOut && error === '') return { ok: 'opened' }
      if (!timedOut) log.warn('update', 'could not open installer, revealing instead', { path, error })
      return reveal()
    },
  }
}
