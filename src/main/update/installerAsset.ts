/**
 * Choosing which release asset this machine should download.
 *
 * Pure, and in a file of its own, because it is the part of the assisted download most likely to
 * be quietly wrong — a release carrying several architectures, a naming convention that changes
 * between electron-builder versions — and the only way to find out otherwise is to ship it.
 */

/** electron-updater's own file entry, narrowed to the parts used here. */
export interface FeedFile {
  url: string
  sha512: string
  size?: number
}

export interface BackendOptions {
  /** `owner/repo`, used to build asset download URLs. */
  repo: string
  platform: NodeJS.Platform
  arch: string
  /** Where to put an assisted download. Defaults to the OS downloads folder. */
  downloadDir?: string
}

/**
 * Chooses the installer to download for this machine.
 *
 * macOS gets the .dmg rather than the .zip: the zip is Squirrel's business, and a user who has to
 * install by hand wants the disk image they would have downloaded from the release page.
 *
 * Linux gets the **.deb**, never the AppImage. This function only serves the *assisted* path, and
 * on Linux that path is taken by exactly one kind of installation: one installed from a .deb (an
 * AppImage run updates itself, through electron-updater — see `decideCapability`). It used to
 * pick the AppImage here, so every .deb install was handed a different packaging from the one it
 * came from — one that on a stock Ubuntu 22.04 or later cannot even start, because those releases
 * no longer ship the libfuse2 AppImages need ("dlopen(): error loading libfuse.so.2"). The
 * `sudo apt install` instruction written for the .deb case could never be shown either, since the
 * downloaded file never ended in `.deb`. No .deb in a release is an error, not a reason to fall
 * back to the AppImage and repeat that.
 *
 * Where a release carries several architectures, the name has to match this machine's — handing
 * an arm64 build to an Intel Mac is a download that ends in a shrug.
 */
export function pickInstaller(
  files: FeedFile[],
  platform: NodeJS.Platform,
  arch: string,
): FeedFile | null {
  const extension = platform === 'darwin' ? '.dmg' : '.deb'
  const candidates = files.filter((f) => f.url.endsWith(extension))
  if (candidates.length === 0) return null

  // Debian names architectures its own way (`apiary_1.18.1_amd64.deb`), and always names them.
  if (extension === '.deb') {
    const debArch = arch === 'x64' ? 'amd64' : arch
    return candidates.find((f) => f.url.endsWith(`_${debArch}.deb`)) ?? null
  }

  // Deliberately no "if there is only one, take it" shortcut: a release carrying a single arm64
  // build would then be handed to an Intel Mac, which is a download that cannot run and a failure
  // the user only meets after it finishes. One candidate still has to be the right architecture.
  // electron-builder puts the arch in the filename for every arch but the default x64, which it
  // may leave unmarked — so an x64 machine takes the file that names no other architecture.
  const named = candidates.find((f) => f.url.includes(arch))
  if (named !== undefined) return named
  if (arch === 'x64') {
    const unmarked = candidates.find((f) => !/arm64|aarch64/.test(f.url))
    if (unmarked !== undefined) return unmarked
  }
  return null
}
