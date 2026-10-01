#!/usr/bin/env node
// Opt-in packaged-app smoke (TEST-7): packages the app for THIS platform as an unpacked directory
// (no installers, no publishing), then runs tests/packaged against that binary.
//
//   npm run test:packaged                  build + package + test
//   npm run test:packaged -- --skip-pack   reuse an existing release/packaged-smoke
//
// Never part of `npm test` or `npm run test:e2e`.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import yaml from 'js-yaml'

// Playwright attaches to Electron through `--inspect`, which the shipped build's
// `enableNodeCliInspectArguments: false` fuse (SEC-3) turns off. So the smoke packages a copy of the
// real config with only that one fuse flipped back on, into its own output directory. Everything
// else - asarUnpack, the file globs, afterPack, the other fuses, the ad-hoc re-sign - is the
// shipped configuration, which is what is under test.
const OUT = join('release', 'packaged-smoke')

const skipPack = process.argv.includes('--skip-pack')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

const root = OUT
const candidates = {
  darwin: [`mac-${process.arch}`, 'mac'].map((d) => join(root, d, 'Apiary.app')),
  linux: [join(root, 'linux-unpacked', 'apiary')],
}[process.platform] ?? []

if (!skipPack) {
  run('npx', ['electron-vite', 'build'])
  const config = yaml.load(readFileSync('electron-builder.yml', 'utf8'))
  config.directories = { ...config.directories, output: OUT }
  config.electronFuses = { ...config.electronFuses, enableNodeCliInspectArguments: true }
  const dir = mkdtempSync(join(tmpdir(), 'apiary-packaged-'))
  const file = join(dir, 'electron-builder.yml')
  writeFileSync(file, yaml.dump(config))
  try {
    run('npx', ['electron-builder', '--config', file, '--dir', '--publish', 'never'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const target = candidates.find((c) => existsSync(c))
if (target === undefined) {
  console.error(`test-packaged: no packaged app found (looked for ${candidates.join(', ') || 'nothing: unsupported platform'})`)
  process.exit(1)
}
env.APIARY_PACKAGED_APP = target
run('npx', ['playwright', 'test', '--config=playwright.packaged.config.ts'])
