import { createWriteStream } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { get } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { app, shell } from 'electron'
import electronUpdater, { type UpdateInfo } from 'electron-updater'
import type { FeedResult, UpdateBackend } from './updateService'
import { pickInstaller, type FeedFile, type BackendOptions } from './installerAsset'

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

export function createUpdateBackend(opts: BackendOptions): UpdateBackend {
  autoUpdater.autoDownload = false
  // Never install behind the user's back on quit: with `assisted` platforms in the mix, "you
  // quit the app and it changed underneath you" would be a different behaviour per platform.
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.logger = null

  /** The metadata from the last successful check, needed to download the right asset. */
  let latest: UpdateInfo | null = null

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
      const file = pickInstaller(latest.files as FeedFile[], opts.platform, opts.arch)
      if (file === null) {
        throw new Error(`Release ${latest.version} has no installer for ${opts.platform} ${opts.arch}`)
      }

      const dir = opts.downloadDir ?? app.getPath('downloads')
      await mkdir(dir, { recursive: true })
      const name = decodeURIComponent(file.url.split('/').pop() ?? `Apiary-${latest.version}`)
      const target = join(dir, name)

      // A previous attempt's leftovers would otherwise be appended to, producing a file that fails
      // its checksum for a reason nobody would guess from the message.
      await rm(target, { force: true })

      const url = `https://github.com/${opts.repo}/releases/download/v${latest.version}/${file.url}`
      const response = await fetchStream(url)
      const total = file.size ?? Number(response.headers['content-length'] ?? 0)
      const hash = createHash('sha512')
      let received = 0

      await new Promise<void>((resolve, reject) => {
        const out = createWriteStream(target)
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
        // A mismatch means the bytes on disk are not the release. Delete them: a half-trusted
        // installer sitting in the downloads folder is worse than no installer at all.
        await rm(target, { force: true })
        throw new Error('The downloaded file did not match the checksum in the release, so it was discarded')
      }
      // Nothing else should be able to produce a zero-length "verified" file, but the cost of
      // being sure is one stat.
      if ((await stat(target)).size === 0) throw new Error('The download was empty')

      return target
    },

    async openInstaller(path: string, action: 'open' | 'reveal'): Promise<void> {
      // `reveal` is not a fallback here, it is the answer. A stock Ubuntu 24.04 desktop registers
      // no handler for `.deb`, and `shell.openPath` on one returns '' — success — having done
      // nothing at all. So the button appeared dead, and the fallback below could never fire
      // because there was no error to fire it. Where the file cannot be handed over, show the
      // user where it is and tell them the command instead (see `installInstructions`).
      if (action === 'reveal') {
        shell.showItemInFolder(path)
        return
      }
      const error = await shell.openPath(path)
      if (error !== '') {
        // Falling back to revealing it: the user can still double-click it themselves, which is
        // better than an error with nothing behind it.
        shell.showItemInFolder(path)
      }
    },
  }
}
