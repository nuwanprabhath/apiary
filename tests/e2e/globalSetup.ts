import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

/**
 * Makes sure Electron's binary is on disk before any worker launches it.
 *
 * Since Electron 44 the npm package has no install script: it downloads and unpacks the binary
 * the first time something asks for its path (`require('electron')`). On a fresh checkout — every
 * CI run — two Playwright workers asked at once, and one exec'd the binary while the other was
 * still writing it: `spawn ETXTBSY`, a red smoke run on a commit with nothing wrong. Asking once,
 * here, before the workers start, leaves them nothing to race over.
 */
export default function globalSetup(): void {
  const require = createRequire(import.meta.url)
  const electronPath = require('electron') as unknown as string
  if (!existsSync(electronPath)) throw new Error(`Electron is not installed at ${electronPath}`)
}
