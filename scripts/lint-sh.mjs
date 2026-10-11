#!/usr/bin/env node
// Runs the system `shellcheck` binary over every tracked shell script.
//
// The npm `shellcheck` package used to provide this, but it fetches the real binary through
// `decompress`, an unmaintained archive-extraction library with a long-standing zip-slip flaw
// (npm audit flags it critical, with no fixed version to upgrade to — the only "fix" audit offers
// is a downgrade to an equally-vulnerable release). shellcheck itself never had a vulnerability;
// only its npm wrapper's download path did. Using a system-installed shellcheck sidesteps it
// entirely: install with `brew install shellcheck` (macOS) or `apt-get install shellcheck`
// (Debian/Ubuntu; already preinstalled on GitHub's ubuntu runners, see ci.yml/release.yml).
import { execFileSync, spawnSync } from 'node:child_process'

// With arguments, just those files (the Stop hook passes what a branch changed, untracked ones
// included); without, every tracked script, as `npm run lint:sh` and CI run it.
const files = process.argv.length > 2
  ? process.argv.slice(2)
  : execFileSync('git', ['ls-files', '*.sh'], { encoding: 'utf8' }).split('\n').filter(Boolean)

if (files.length === 0) {
  process.exit(0)
}

const result = spawnSync('shellcheck', files, { stdio: 'inherit' })

if (result.error) {
  if (result.error.code === 'ENOENT') {
    console.error(
      'lint:sh: shellcheck is not installed. Install it with `brew install shellcheck` (macOS) ' +
        'or `apt-get install shellcheck` (Debian/Ubuntu), then re-run `npm run lint:sh`.',
    )
  } else {
    console.error(result.error.message)
  }
  process.exit(1)
}

process.exit(result.status ?? 1)
