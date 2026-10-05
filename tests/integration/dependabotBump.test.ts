import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git, initRepo } from '../fixtures/gitRepo'
import {
  BOT,
  bumpSubject,
  changelogSection,
  parseUpdates,
  syncBranch,
} from '../../scripts/dependabot-bump.mjs'

/**
 * scripts/dependabot-bump.mjs, run by .github/workflows/dependabot-bump.yml on Dependabot's PRs:
 * the parsing against Dependabot's real commit-message formats, and the branch rebuild against
 * real git repositories.
 */

const GROUPED = `chore(deps-dev): bump the vitest group across 1 directory with 2 updates

Bumps the vitest group with 2 updates in the / directory: [vitest](https://x) and [@vitest/ui](https://y).


Updates \`vitest\` from 5.0.2 to 5.0.3
- [Release notes](https://github.com/vitest-dev/vitest/releases)

Updates \`@vitest/ui\` from 5.0.2 to 5.0.3
- [Release notes](https://github.com/vitest-dev/vitest/releases)

---
updated-dependencies:
- dependency-name: vitest
  dependency-version: 5.0.3
...`

const SINGLE = `chore(deps-dev): bump esbuild from 0.25.12 to 0.28.2

Bumps [esbuild](https://github.com/evanw/esbuild) from 0.25.12 to 0.28.2.
- [Release notes](https://github.com/evanw/esbuild/releases)

Signed-off-by: dependabot[bot] <support@github.com>`

describe('parsing Dependabot commit messages', () => {
  it('reads every update of a grouped PR and the one of a single PR', () => {
    expect(parseUpdates(GROUPED)).toEqual([
      { name: 'vitest', from: '5.0.2', to: '5.0.3' },
      { name: '@vitest/ui', from: '5.0.2', to: '5.0.3' },
    ])
    expect(parseUpdates(SINGLE)).toEqual([{ name: 'esbuild', from: '0.25.12', to: '0.28.2' }])
  })

  it('drops a name that is not plain package-name characters, so nothing else reaches CHANGELOG.md', () => {
    expect(parseUpdates('Updates `x](javascript:alert(1))` from 1.0.0 to 2.0.0')).toEqual([])
    expect(parseUpdates('Updates `<img src=x>` from 1.0.0 to 2.0.0')).toEqual([])
  })
})

describe('the CHANGELOG section and commit subject', () => {
  it('lists npm packages under Dependencies and actions under GitHub actions', () => {
    const section = changelogSection('1.2.4', '2026-10-12', [
      { name: 'vitest', from: '5.0.2', to: '5.0.3' },
      { name: '@vitest/ui', from: '5.0.2', to: '5.0.3' },
      { name: 'actions/checkout', from: '7.0.1', to: '7.1.0' },
    ])
    expect(section).toBe(
      '## [1.2.4] - 2026-10-12\n\n### Changed\n\n' +
        '- **Dependencies.** vitest 5.0.3 and @vitest/ui 5.0.3.\n' +
        '- **GitHub actions.** actions/checkout 7.1.0.\n\n',
    )
  })

  it('wraps a long list at about 100 columns', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `package-number-${i}`, from: '1.0.0', to: '1.0.1' }))
    const lines = changelogSection('1.0.1', '2026-10-12', many).split('\n')
    expect(lines.every((l) => l.length <= 100)).toBe(true)
    expect(lines.filter((l) => l.startsWith('  ')).length).toBeGreaterThan(0)
  })

  it('carries the version in a conventional subject of at most 150 characters', () => {
    expect(bumpSubject('1.2.4', 'chore(deps-dev): bump esbuild from 0.25.12 to 0.28.2')).toBe(
      'chore(deps): 1.2.4 — bump esbuild from 0.25.12 to 0.28.2',
    )
    expect(bumpSubject('1.2.4', `chore(deps): bump ${'x'.repeat(200)}`)).toHaveLength(150)
  })
})

describe('rebuilding a Dependabot branch on main', () => {
  let repo: string
  const PKG = (version: string, esbuild = '^0.25.12'): string =>
    `{\n  "name": "app",\n  "version": "${version}",\n  "devDependencies": {\n    "esbuild": "${esbuild}"\n  }\n}\n`
  const LOCK = (version: string): string =>
    `${JSON.stringify({ name: 'app', version, lockfileVersion: 3, packages: { '': { name: 'app', version } } }, null, 2)}\n`
  const LOG = (top: string): string => `# Changelog\n\nIntro.\n\n## [${top}] - 2026-10-01\n\n### Added\n\n- Something.\n`

  const commitAs = (author: string, message: string, files: Record<string, string>): void => {
    for (const [file, content] of Object.entries(files)) writeFileSync(join(repo, file), content)
    git(repo, 'add', '.')
    git(repo, '-c', 'commit.gpgsign=false', '-c', `user.name=${author}`, '-c', 'user.email=a@b.c', 'commit', '-qm', message)
  }
  const dependabotBranch = (): void => {
    git(repo, 'checkout', '-q', '-b', 'deps', 'main')
    commitAs('dependabot[bot]', SINGLE, { 'package.json': PKG('1.0.0', '^0.28.2') })
    git(repo, 'checkout', '-q', 'main')
  }
  const sync = () => syncBranch({ dir: repo, main: 'main', branch: 'deps', date: '2026-10-12' })
  const subjects = (range: string): string[] => git(repo, 'log', '--format=%an|%s', range).trim().split('\n')

  beforeEach(() => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-depbump-')))
    initRepo(repo)
    commitAs('Maintainer', 'chore: 1.0.0', {
      'package.json': PKG('1.0.0'),
      'package-lock.json': LOCK('1.0.0'),
      'CHANGELOG.md': LOG('1.0.0'),
    })
  })
  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it("adds one commit on top of Dependabot's with the next patch version and its CHANGELOG section", () => {
    dependabotBranch()
    const result = sync()
    expect(result).toMatchObject({ action: 'bumped', version: '1.0.1' })
    if (result.action !== 'bumped') return
    git(repo, 'branch', '-f', 'deps', result.sha)

    expect(subjects('main..deps')).toEqual([
      `${BOT.name}|chore(deps): 1.0.1 — bump esbuild from 0.25.12 to 0.28.2`,
      'dependabot[bot]|chore(deps-dev): bump esbuild from 0.25.12 to 0.28.2',
    ])
    // package.json keeps its formatting and Dependabot's change; only the version moves.
    expect(git(repo, 'show', 'deps:package.json')).toBe(PKG('1.0.1', '^0.28.2'))
    expect(JSON.parse(git(repo, 'show', 'deps:package-lock.json'))).toMatchObject({
      version: '1.0.1',
      packages: { '': { version: '1.0.1' } },
    })
    expect(git(repo, 'show', 'deps:CHANGELOG.md')).toBe(
      '# Changelog\n\nIntro.\n\n## [1.0.1] - 2026-10-12\n\n### Changed\n\n- **Dependencies.** esbuild 0.28.2.\n\n' +
        '## [1.0.0] - 2026-10-01\n\n### Added\n\n- Something.\n',
    )
  })

  it('does nothing when the branch is already bumped on the tip of main', () => {
    dependabotBranch()
    const first = sync()
    if (first.action !== 'bumped') throw new Error('expected a bump')
    git(repo, 'branch', '-f', 'deps', first.sha)
    expect(sync()).toEqual({ action: 'skip', reason: 'already 1.0.1 on the tip of main' })
  })

  it('replaces its old bump with a fresh one after main moves on', () => {
    dependabotBranch()
    const first = sync()
    if (first.action !== 'bumped') throw new Error('expected a bump')
    git(repo, 'checkout', '-q', 'main')
    git(repo, 'branch', '-f', 'deps', first.sha)
    // Another PR lands on main as 1.0.1.
    commitAs('Maintainer', 'chore: 1.0.1', {
      'package.json': PKG('1.0.1'),
      'package-lock.json': LOCK('1.0.1'),
      'CHANGELOG.md': LOG('1.0.1'),
    })

    const second = sync()
    expect(second).toMatchObject({ action: 'bumped', version: '1.0.2' })
    if (second.action !== 'bumped') return
    git(repo, 'branch', '-f', 'deps', second.sha)
    expect(git(repo, 'merge-base', 'main', 'deps')).toBe(git(repo, 'rev-parse', 'main'))
    expect(subjects('main..deps')).toHaveLength(2)
    expect(git(repo, 'show', 'deps:package.json')).toBe(PKG('1.0.2', '^0.28.2'))
    expect(git(repo, 'show', 'deps:CHANGELOG.md')).toMatch(/## \[1\.0\.2\][^]*## \[1\.0\.1\]/)
  })

  it("strips its bump when Dependabot's change no longer applies, so Dependabot can rebase it", () => {
    dependabotBranch()
    const first = sync()
    if (first.action !== 'bumped') throw new Error('expected a bump')
    git(repo, 'checkout', '-q', 'main')
    git(repo, 'branch', '-f', 'deps', first.sha)
    const dependabotTip = git(repo, 'rev-parse', 'deps~1').trim()
    // main changes the same line Dependabot did.
    commitAs('Maintainer', 'chore: esbuild by hand', { 'package.json': PKG('1.0.0', '^0.27.0') })

    expect(sync()).toEqual({ action: 'strip', sha: dependabotTip, old: first.sha })
  })

  it('leaves a branch alone once someone else has pushed to it', () => {
    dependabotBranch()
    git(repo, 'checkout', '-q', 'deps')
    commitAs('Maintainer', 'fix: by hand', { 'README.md': 'edited' })
    git(repo, 'checkout', '-q', 'main')
    expect(sync()).toEqual({ action: 'skip', reason: 'edited by someone else' })
  })

  it('never touches CHANGELOG.md or package.json on main itself', () => {
    dependabotBranch()
    sync()
    expect(git(repo, 'show', 'main:package.json')).toBe(PKG('1.0.0'))
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('init')
  })
})
