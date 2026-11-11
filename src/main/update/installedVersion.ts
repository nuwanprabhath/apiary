import { dirname, join } from 'node:path'
import { parseVersion } from './versions'

/** Where the Apiary on disk says its version is, for the platform running this process. */
export interface InstalledVersionInput {
  platform: NodeJS.Platform
  packaged: boolean
  /** `process.env.APPIMAGE`: an AppImage replaces itself, so nothing is ever installed under it. */
  appImagePath: string | undefined
  /** `process.execPath`: inside `Contents/MacOS` of the bundle on a Mac. */
  execPath: string
  /** Runs a short-lived command and returns its stdout (`createExec`). */
  exec: (file: string, args: string[], cwd: string) => Promise<string>
  readFile: (path: string) => string
}

/** The `CFBundleShortVersionString` of an `Info.plist`, or null. */
export function plistVersion(plist: string): string | null {
  const match = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)
  return match?.[1]?.trim() ?? null
}

/**
 * The version of the Apiary installed on disk, or null where there is nothing to compare (an
 * AppImage, a dev run, another system). A .deb is asked of dpkg, which reads its database and not
 * the files: Electron holds the open `app.asar`, so reading through it returns the old file. A Mac
 * bundle's `Info.plist` is outside the asar and is replaced with the bundle.
 */
export async function readInstalledVersion(input: InstalledVersionInput): Promise<string | null> {
  if (!input.packaged || input.appImagePath !== undefined) return null
  let raw: string | null = null
  if (input.platform === 'linux') {
    raw = (await input.exec('dpkg-query', ['-W', '-f=${Version}', 'apiary'], '/')).trim()
  } else if (input.platform === 'darwin') {
    raw = plistVersion(input.readFile(join(dirname(dirname(input.execPath)), 'Info.plist')))
  }
  // A Debian revision (`X.Y.Z-1`) reads as a pre-release to SemVer, so it is cut off first.
  const version = raw === null ? null : (raw.replace(/-\d+$/, ''))
  return version !== null && parseVersion(version) !== null ? version : null
}
