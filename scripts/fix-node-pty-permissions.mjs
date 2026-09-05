#!/usr/bin/env node
// node-pty ships a small native helper binary, `spawn-helper`, that it execs
// on macOS/Linux before exec'ing the real shell (see node-pty's
// lib/unixTerminal.js). On macOS the helper comes from a prebuilt tarball
// (node_modules/node-pty/prebuilds/<platform>-<arch>/spawn-helper); tarball
// extraction (npm, or later an asar-unpack step) does not reliably preserve
// the executable bit, which makes every real spawn fail with
// `posix_spawnp failed`. This script restores it after every install, and
// its core logic is reused by the electron-builder `afterPack` hook
// (build/afterPack.cjs) to fix the same binary inside the packaged app.
//
// This must never fail `npm install` (or the packaging build): any problem
// here is reported and the script exits 0 / resolves without throwing.

import { existsSync, chmodSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Restores the executable bit on node-pty's `spawn-helper` binary inside a
// given node-pty package directory. Returns a short report object; never
// throws. `log` defaults to console.log but callers (like the afterPack
// hook) may pass their own to prefix messages differently.
export function fixNodePtyPermissions(nodePtyDir, log = console.log) {
  if (process.platform === 'win32') {
    log('Windows uses conpty, not spawn-helper — nothing to do.')
    return { found: 0, fixed: 0 }
  }

  if (!nodePtyDir || !existsSync(nodePtyDir)) {
    log(`node-pty directory not found at ${nodePtyDir} — skipping.`)
    return { found: 0, fixed: 0 }
  }

  // node-pty resolves its native module (and spawn-helper alongside it) from
  // build/Release, build/Debug, or prebuilds/<platform>-<arch>, in that
  // order (see node-pty's lib/utils.js). Check every location that exists so
  // this works whether node-pty was installed from a prebuild or compiled
  // from source.
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

// Only run as a CLI (postinstall) when invoked directly, not when imported
// by the afterPack hook. pathToFileURL handles platform path quirks (e.g.
// Windows drive letters/backslashes) that a hand-built `file://` string
// would not.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (err) {
    console.log(`[fix-node-pty-permissions] Unexpected error, ignoring: ${err && err.message ? err.message : err}`)
  }
  process.exit(0)
}
