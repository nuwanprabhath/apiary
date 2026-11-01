import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { macInstallScript } from '../../src/main/update/installCommands'

/**
 * The generated macOS install helper, run for real against a dummy `Apiary.app` in a temp folder:
 * hdiutil, ditto, the swap, xattr and the result file. Never touches /Applications or a real app.
 */

/** macOS's own tools, by path: they ship with the OS, not with any package. */
const XATTR = '/usr/bin/xattr'
const HDIUTIL = '/usr/bin/hdiutil'

function bundle(at: string, version: string): void {
  mkdirSync(join(at, 'Contents', 'MacOS'), { recursive: true })
  writeFileSync(join(at, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>
`)
  writeFileSync(join(at, 'Contents', 'MacOS', 'Apiary'), '#!/bin/sh\n', { mode: 0o755 })
}

const versionOf = (app: string): string => /<string>([^<]+)<\/string>/.exec(readFileSync(join(app, 'Contents', 'Info.plist'), 'utf8'))?.[1] ?? ''

/** A pid that has already exited, so the helper does not wait. */
function exitedPid(): number {
  const child = spawnSync('/bin/sh', ['-c', 'echo $$'], { encoding: 'utf8' })
  return Number(child.stdout.trim())
}

describe.runIf(process.platform === 'darwin')('the macOS install helper', () => {
  let root: string
  let app: string
  let dmg: string
  let result: string
  let marker: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'apiary-mac-install-'))
    app = join(root, 'Applications', 'Apiary.app')
    bundle(app, '1.50.0')
    dmg = join(root, 'Downloads', 'Apiary 1.51.0.dmg')
    mkdirSync(join(root, 'Downloads'))
    result = join(root, 'userData', 'update-result.json')
    mkdirSync(join(root, 'userData'))
    marker = join(root, 'relaunched')
  })

  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  function run(): void {
    const scriptDir = mkdtempSync(join(root, 'helper-'))
    const script = join(scriptDir, 'install.sh')
    writeFileSync(script, macInstallScript({
      pid: exitedPid(), dmg, bundle: app, resultFile: result, version: '1.51.0', uid: process.getuid?.() ?? 501,
      relaunch: `touch '${marker}'`,
    }), { mode: 0o700 })
    spawnSync('/bin/sh', [script], { stdio: 'ignore', timeout: 60_000 })
  }

  it('installs the new version, clears its quarantine, deletes the .dmg, says ok and relaunches', () => {
    const source = join(root, 'src')
    bundle(join(source, 'Apiary.app'), '1.51.0')
    execFileSync(XATTR, ['-w', 'com.apple.quarantine', '0081;00000000;Apiary;', join(source, 'Apiary.app')])
    execFileSync(HDIUTIL, ['create', '-quiet', '-fs', 'HFS+', '-srcfolder', source, '-volname', 'Apiary', dmg])
    run()
    expect(versionOf(app)).toBe('1.51.0')
    expect(execFileSync(XATTR, ['-l', app], { encoding: 'utf8' })).not.toContain('com.apple.quarantine')
    expect(existsSync(dmg)).toBe(false)
    expect(JSON.parse(readFileSync(result, 'utf8'))).toMatchObject({ version: '1.51.0', ok: true })
    expect(existsSync(marker)).toBe(true)
  }, 90_000)

  it('a corrupt .dmg leaves the old version in place, keeps the .dmg and says it failed', () => {
    writeFileSync(dmg, 'not a disk image')
    run()
    expect(versionOf(app)).toBe('1.50.0')
    expect(existsSync(dmg)).toBe(true)
    expect(JSON.parse(readFileSync(result, 'utf8'))).toMatchObject({ version: '1.51.0', ok: false, path: dmg })
    expect(existsSync(marker)).toBe(true)
  }, 90_000)
})
