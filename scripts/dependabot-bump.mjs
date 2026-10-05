#!/usr/bin/env node
// Gives a Dependabot PR what every change here needs (CLAUDE.md, "Versioning, changelog,
// commits"): its own patch version and CHANGELOG section, so the PR can be merged as it stands.
// Run by .github/workflows/dependabot-bump.yml.
//
// For one PR branch it replays Dependabot's own commits onto the tip of main and adds one commit
// on top that bumps package.json/package-lock.json and inserts the CHANGELOG section. Run again
// after main moves (another PR merged, so the version and the CHANGELOG top changed), it drops its
// old bump commit and does it again. The bump is always main's version + 1 patch.
//
// Two cases it leaves alone, by design:
// - Someone else pushed to the branch. Their commit is theirs to keep; it does nothing.
// - Dependabot's commits no longer apply on main (usually package-lock.json). It strips its own
//   bump so the branch is Dependabot's alone again; Dependabot then rebases it by itself, and the
//   resulting `synchronize` runs this again.
//
// Security: the workflow runs on `pull_request_target`, with a write token. Nothing from the PR is
// ever executed — no npm, no scripts. The PR's commits are cherry-picked as data, and what is
// written into CHANGELOG.md from Dependabot's commit message is filtered to package-name characters.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const DEPENDABOT = 'dependabot[bot]'
export const BOT = { name: 'github-actions[bot]', email: '41898282+github-actions[bot]@users.noreply.github.com' }
const BUMP_SUBJECT = /^chore\(deps\): \d+\.\d+\.\d+ — /
const SAFE = /^[@\w./-]+$/
const SUBJECT_MAX = 150

export function nextPatch(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!m) throw new Error(`not a plain x.y.z version: ${version}`)
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`
}

/** `{ name, from, to }` for each update a Dependabot commit message names, grouped or single. */
export function parseUpdates(message) {
  const found = new Map()
  const add = (name, from, to) => {
    to = to.replace(/\.$/, '')
    if (SAFE.test(name) && SAFE.test(from) && SAFE.test(to)) found.set(name, { name, from, to })
  }
  for (const m of message.matchAll(/^Updates `([^`]+)` from (\S+) to (\S+)$/gm)) add(m[1], m[2], m[3])
  for (const m of message.matchAll(/^Bumps \[([^\]]+)\]\([^)]*\) from (\S+) to (\S+)$/gm)) add(m[1], m[2], m[3])
  return [...found.values()]
}

// Wraps a list item at ~100 columns, as the hand-written sections are (.markdownlint-cli2.jsonc).
function wrap(text) {
  const lines = []
  let line = '-'
  for (const word of text.split(' ')) {
    if (line.length + 1 + word.length > 100) {
      lines.push(line)
      line = ' '
    }
    line += ` ${word}`
  }
  lines.push(line)
  return lines.join('\n')
}

export function changelogSection(version, date, updates) {
  const list = (items) =>
    items.length === 1
      ? items[0]
      : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
  // npm names never contain a slash unless scoped (@scope/name); action names always do.
  const actions = updates.filter((u) => u.name.includes('/') && !u.name.startsWith('@'))
  const npm = updates.filter((u) => !actions.includes(u))
  const items = []
  if (npm.length) items.push(wrap(`**Dependencies.** ${list(npm.map((u) => `${u.name} ${u.to}`))}.`))
  if (actions.length) items.push(wrap(`**GitHub actions.** ${list(actions.map((u) => `${u.name} ${u.to}`))}.`))
  return `## [${version}] - ${date}\n\n### Changed\n\n${items.join('\n')}\n\n`
}

export function bumpSubject(version, dependabotSubject) {
  const what = dependabotSubject.replace(/^[a-z]+(\([^)]*\))?!?: /, '')
  const subject = `chore(deps): ${version} — ${what}`
  return subject.length <= SUBJECT_MAX ? subject : `${subject.slice(0, SUBJECT_MAX - 1)}…`
}

/** Writes the version into package.json and package-lock.json and the section into CHANGELOG.md. */
export function applyBump(dir, version, section) {
  const pkgPath = join(dir, 'package.json')
  // A text edit, not a JSON round-trip, so package.json keeps its exact formatting.
  const pkg = readFileSync(pkgPath, 'utf8').replace(/("version":\s*")[^"]+(")/, `$1${version}$2`)
  writeFileSync(pkgPath, pkg)

  const lockPath = join(dir, 'package-lock.json')
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  lock.version = version
  if (lock.packages?.['']) lock.packages[''].version = version
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`)

  const logPath = join(dir, 'CHANGELOG.md')
  const log = readFileSync(logPath, 'utf8')
  const at = log.indexOf('\n## [')
  if (at === -1) throw new Error('CHANGELOG.md has no version section to insert before')
  writeFileSync(logPath, `${log.slice(0, at + 1)}${section}${log.slice(at + 1)}`)
}

/**
 * Rebuilds `branch` as main + Dependabot's commits + one bump commit, in the checkout at `dir`.
 * Leaves HEAD on the result and says what to push; the caller pushes (with a lease on `old`).
 *
 * @returns {{ action: 'bumped', sha: string, old: string, version: string, subject: string }
 *   | { action: 'strip', sha: string, old: string }
 *   | { action: 'skip', reason: string }}
 */
export function syncBranch({ dir, main, branch, date }) {
  // Cherry-picks and commits as the bot (a CI checkout has no identity), never signed (a
  // developer's own gpg config must not prompt in a test).
  const run = (...args) =>
    execFileSync(
      'git',
      ['-c', `user.name=${BOT.name}`, '-c', `user.email=${BOT.email}`, '-c', 'commit.gpgsign=false', ...args],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
  const git = (...args) => run(...args).trim()
  const old = git('rev-parse', branch)
  const mainSha = git('rev-parse', main)
  const commits = git('log', '--reverse', '--format=%H%x09%an%x09%s', `${main}..${branch}`)
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, author, subject] = line.split('\t')
      return { sha, author, subject }
    })
  const isBump = (c) => c.author === BOT.name && BUMP_SUBJECT.test(c.subject)
  const ours = commits.filter((c) => !isBump(c))
  if (ours.some((c) => c.author !== DEPENDABOT)) return { action: 'skip', reason: 'edited by someone else' }
  if (ours.length === 0) return { action: 'skip', reason: 'no Dependabot commits ahead of main' }
  // A bump is only ever the last commit; one anywhere else means the history was rearranged.
  if (commits.findIndex(isBump) !== -1 && commits.findIndex(isBump) !== commits.length - 1) {
    return { action: 'skip', reason: 'bump commit is not the last commit' }
  }

  const version = nextPatch(JSON.parse(git('show', `${main}:package.json`)).version)
  const last = commits[commits.length - 1]
  const upToDate =
    git('merge-base', main, branch) === mainSha &&
    isBump(last) &&
    JSON.parse(git('show', `${branch}:package.json`)).version === version
  if (upToDate) return { action: 'skip', reason: `already ${version} on the tip of main` }

  git('checkout', '--quiet', '--detach', mainSha)
  try {
    git('cherry-pick', '--allow-empty', ...ours.map((c) => c.sha))
  } catch {
    try {
      git('cherry-pick', '--abort')
    } catch {
      // nothing in progress
    }
    const dependabotTip = ours[ours.length - 1].sha
    if (dependabotTip === old) return { action: 'skip', reason: 'does not apply on main; Dependabot will rebase it' }
    git('checkout', '--quiet', '--detach', dependabotTip)
    return { action: 'strip', sha: dependabotTip, old }
  }

  const updates = ours.flatMap((c) => parseUpdates(run('log', '-1', '--format=%B', c.sha)))
  applyBump(dir, version, changelogSection(version, date, updates))
  const subject = bumpSubject(version, ours[ours.length - 1].subject)
  git('add', 'package.json', 'package-lock.json', 'CHANGELOG.md')
  git(
    'commit', '--quiet', '--no-verify', '-m', subject,
    '-m', 'Version and CHANGELOG for the update above, by .github/workflows/dependabot-bump.yml.',
  )
  return { action: 'bumped', sha: git('rev-parse', 'HEAD'), old, version, subject }
}

// CLI: node scripts/dependabot-bump.mjs <main-ref> <branch-ref>; prints the result as JSON.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [main, branch] = process.argv.slice(2)
  if (!main || !branch) {
    console.error('usage: dependabot-bump.mjs <main-ref> <branch-ref>')
    process.exit(2)
  }
  const date = new Date().toISOString().slice(0, 10)
  console.log(JSON.stringify(syncBranch({ dir: process.cwd(), main, branch, date })))
}
