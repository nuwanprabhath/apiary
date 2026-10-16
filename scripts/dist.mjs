#!/usr/bin/env node
// Runs electron-builder scoped to the host machine's own architecture.
//
// electron-builder.yml declares both arm64 and x64 for the mac dmg target, but building a
// *foreign* arch needs @electron/rebuild to cross-compile native modules (better-sqlite3,
// node-pty), which pulls in node-gyp's Python toolchain. So `npm run dist` builds the host arch
// only; the other mac arch is an opt-in first CLI arg (`node scripts/dist.mjs arm64` / `x64`, as
// `dist:mac:arm64` / `dist:mac:x64` do). `dist:mac:all` / `dist:linux` bypass this script.
//
// electron-builder always auto-discovers `electron-builder.yml` and deep-merges a programmatic
// config into it, concatenating arrays, so a narrowed `mac.target[].arch` would be unioned back
// with `[arm64, x64]`. The narrowed config is written to its own temp file and passed as
// `--config`, which electron-builder reads alone.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';

const config = load(readFileSync('electron-builder.yml', 'utf8'));

if (process.platform === 'darwin') {
  const requestedArch = process.argv[2] ?? process.arch;
  if (requestedArch !== 'arm64' && requestedArch !== 'x64') {
    console.error(`scripts/dist.mjs: unsupported mac arch "${requestedArch}" (expected "arm64" or "x64")`);
    process.exit(1);
  }
  config.mac.target = [
    { target: 'dmg', arch: [requestedArch] },
    // The zip goes with it: latest-mac.yml names it, so a release built without one describes a
    // file that is not there.
    { target: 'zip', arch: [requestedArch] },
  ];
}
// Linux target only declares x64 today, so no narrowing is needed there.

const dir = mkdtempSync(join(tmpdir(), 'apiary-dist-'));
const cfgPath = join(dir, 'electron-builder.generated.json');
writeFileSync(cfgPath, JSON.stringify(config));

let result;
try {
  // --publish never: electron-builder auto-publishes to GitHub Releases on its own whenever a
  // git tag is checked out, and fails without a GH_TOKEN — see the comment in
  // electron-builder.yml for why this is a CLI flag rather than a `publish: never` config key.
  result = spawnSync('npx', ['electron-builder', '--config', cfgPath, '--publish', 'never'], { stdio: 'inherit' });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exit(result.status ?? 1);
