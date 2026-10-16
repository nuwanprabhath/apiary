#!/usr/bin/env node
// node-pty execs a native helper, `spawn-helper`, before the real shell. On macOS it comes from a
// prebuilt tarball (node_modules/node-pty/prebuilds/<platform>-<arch>/spawn-helper), and
// extraction (npm, or an asar-unpack step) does not reliably keep the executable bit, so every
// spawn fails with `posix_spawnp failed`. This restores it after every install; the
// electron-builder `afterPack` hook (build/afterPack.cjs) reuses it for the packaged app.
//
// It must never fail `npm install` or the packaging build: problems are reported, not thrown.

import { existsSync, chmodSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Returns a short report object; never throws. `log` defaults to console.log.
export function fixNodePtyPermissions(nodePtyDir, log = console.log) {
  if (process.platform === 'win32') {
    log('Windows uses conpty, not spawn-helper — nothing to do.')
    return { found: 0, fixed: 0 }
  }

  if (!nodePtyDir || !existsSync(nodePtyDir)) {
    log(`node-pty directory not found at ${nodePtyDir} — skipping.`)
    return { found: 0, fixed: 0 }
  }

  // node-pty resolves spawn-helper from build/Release, build/Debug, or prebuilds/<platform>-<arch>
  // (node-pty's lib/utils.js); check each, since it may be prebuilt or compiled.
  const candidateDirs = [
    join(nodePtyDir, 'build', 'Release'),
    join(nodePtyDir, 'build', 'Debug'),
    join(nodePtyDir, 'prebuilds', `${process.platform}-${process.arch}`),
  ]

  let found = 0
  let fixed = 0

  for (const dir of candidateDirs) {
    const helperPath = join(dir, 'spawn-helper')
    if (!existsSync(helperPath)) continue
    found++
    try {
      const mode = statSync(helperPath).mode
      const isExecutable = (mode & 0o111) !== 0
      if (!isExecutable) {
        chmodSync(helperPath, 0o755)
        fixed++
        log(`Restored executable bit on ${helperPath}`)
      }
    } catch (err) {
      log(`Could not chmod ${helperPath}: ${err.message}`)
    }
  }

  if (found === 0) {
    log('No spawn-helper binary found for this platform/arch — skipping.')
  }

  return { found, fixed }
}

function main() {
  const nodePtyDir = join(process.cwd(), 'node_modules', 'node-pty')
  fixNodePtyPermissions(nodePtyDir, (msg) => console.log(`[fix-node-pty-permissions] ${msg}`))
}

// CLI (postinstall) only when invoked directly, not when imported by the afterPack hook;
// pathToFileURL handles Windows drive letters/backslashes.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (err) {
    console.log(`[fix-node-pty-permissions] Unexpected error, ignoring: ${err && err.message ? err.message : err}`)
  }
  process.exit(0)
}
