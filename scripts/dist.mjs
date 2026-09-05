#!/usr/bin/env node
// Runs electron-builder scoped to the host machine's own architecture.
//
// electron-builder.yml declares both arm64 and x64 for the mac dmg target
// (matching the packaging brief), but building a *foreign* arch from a
// single host requires @electron/rebuild to cross-compile native modules
// (better-sqlite3, node-pty) for that other arch, which pulls in node-gyp's
// Python toolchain (distutils/setuptools) — not something every machine has
// set up, and not something `npm run dist` should silently depend on.
//
// So `npm run dist` builds host-arch only, which works out of the box
// everywhere. Building the other mac arch is an explicit opt-in — pass it
// as the first CLI arg (`node scripts/dist.mjs arm64` / `x64`), which is
// what `dist:mac:arm64` / `dist:mac:x64` in package.json do. With no arg,
// this defaults to the host's own arch (`process.arch`) — `npm run dist`'s
// existing, verified behaviour is unchanged. See the README for the
// `dist:mac:all` / `dist:linux` scripts, which do not go through this
// dispatcher (they don't rely on a flag to narrow anything).
//
// Implementation note: electron-builder's config loader *always*
// auto-discovers `electron-builder.yml` in the project root, even when a
// config object is passed programmatically, and then deep-merges the two —
// merging concatenates array fields rather than replacing them, so a
// narrowed `mac.target[].arch` passed inline ends up unioned right back
// with the file's `[arm64, x64]`. Writing the narrowed config out to its
// own temp file and pointing `--config` at that file avoids the merge
// entirely: electron-builder reads only the file named by `--config`.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

const config = yaml.load(readFileSync('electron-builder.yml', 'utf8'));

if (process.platform === 'darwin') {
  const requestedArch = process.argv[2] ?? process.arch;
  if (requestedArch !== 'arm64' && requestedArch !== 'x64') {
    console.error(`scripts/dist.mjs: unsupported mac arch "${requestedArch}" (expected "arm64" or "x64")`);
    process.exit(1);
  }
  config.mac.target = [{ target: 'dmg', arch: [requestedArch] }];
}
// Linux target only declares x64 today, so no narrowing is needed there.

const dir = mkdtempSync(join(tmpdir(), 'apiary-dist-'));
const cfgPath = join(dir, 'electron-builder.generated.json');
writeFileSync(cfgPath, JSON.stringify(config));

let result;
try {
  result = spawnSync('npx', ['electron-builder', '--config', cfgPath], { stdio: 'inherit' });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exit(result.status ?? 1);
