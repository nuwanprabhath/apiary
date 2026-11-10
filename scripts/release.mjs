#!/usr/bin/env node
// One command for a release: checks, push main, wait for CI, tag, watch the release run, retry
// transient download failures, check the published release. `--dry-run` prints the plan only.
//
//   node scripts/release.mjs [--dry-run] [--yes] [--allow-gap]
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { ciVerdict } from './release-ci-gate.mjs'

const EXPECTED_ASSETS = [/\.dmg$/, /\.zip$/, /^latest-mac\.yml$/, /\.AppImage$/, /\.deb$/, /^latest-linux\.yml$/, /^latest-mac\.yml\.sig$/, /^latest-linux\.yml\.sig$/]
const MAX_RERUNS = 2

const compare = (a, b) => {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

/**
 * Headings of a changelog, newest first.
 * @param {string} text
 * @returns {{ version: string, annotated: boolean }[]}
 */
export function changelogHeadings(text) {
  return [...text.matchAll(/^## \[(\d+\.\d+\.\d+)\](.*)$/gm)].map((m) => ({ version: m[1], annotated: /\(not released/.test(m[2]) }))
}

/**
 * Versions whose heading should read "(not released; shipped in X)": no release tag of their own,
 * not annotated yet, and a later version was released (X is the earliest such).
 * @param {string} changelog
 * @param {string[]} releasedTags
 * @returns {{ version: string, shippedIn: string }[]}
 */
export function versionsToAnnotate(changelog, releasedTags) {
  const released = releasedTags.map((t) => t.replace(/^v/, '')).sort(compare)
  const out = []
  for (const { version, annotated } of changelogHeadings(changelog)) {
    if (annotated || released.includes(version)) continue
    const shippedIn = released.find((r) => compare(r, version) > 0)
    if (shippedIn !== undefined) out.push({ version, shippedIn })
  }
  return out
}

/**
 * Tags (newest first) that have no GitHub release.
 * @param {string[]} tags
 * @param {string[]} releaseTags
 * @returns {string[]}
 */
export function tagsWithoutRelease(tags, releaseTags) {
  return tags.filter((t) => !releaseTags.includes(t))
}

/**
 * A failed job's log that ends in a download error worth re-running for, not a real failure.
 * @param {string} log
 * @returns {boolean}
 */
export function isTransientDownloadFailure(log) {
  return /Response code 5\d\d/.test(log) || /(ETIMEDOUT|ECONNRESET)/.test(log)
}

/**
 * Which of the eight expected assets are missing from the release's asset names.
 * @param {string[]} names
 * @returns {string[]}
 */
export function missingAssets(names) {
  return EXPECTED_ASSETS.filter((re) => !names.some((n) => re.test(n))).map(String)
}

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim()
const gh = (...args) => sh('gh', args)
const step = (n, text) => console.log(`[${n}] ${text}`)

const PLAN = [
  'refuse unless on main, clean tree, package.json version = newest changelog heading',
  'list tags without a release (stop unless --allow-gap)',
  'confirm (unless --yes), then push main',
  'wait for CI on that commit',
  'create and push the tag',
  'watch the release run; re-run failed jobs on a transient download error (at most twice)',
  'check the release is published with its eight assets',
]

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(`${question} [y/N] `)
  rl.close()
  return /^y(es)?$/i.test(answer.trim())
}

function fail(message) {
  console.error(`release: ${message}`)
  process.exit(1)
}

async function waitForCi(sha) {
  for (;;) {
    const runs = JSON.parse(gh('run', 'list', '--workflow', 'ci.yml', '--commit', sha, '--limit', '5', '--json', 'databaseId,status,conclusion'))
    if (runs[0] !== undefined && runs[0].status !== 'completed') {
      spawnSync('gh', ['run', 'watch', String(runs[0].databaseId), '--exit-status'], { stdio: 'inherit' })
      continue
    }
    const why = ciVerdict(runs, sha)
    if (why !== null) fail(why)
    return
  }
}

function watchRelease(tag) {
  for (let attempt = 0; ; attempt++) {
    const runs = JSON.parse(gh('run', 'list', '--workflow', 'release.yml', '--branch', tag, '--limit', '1', '--json', 'databaseId'))
    if (runs[0] === undefined) fail(`no release run started for ${tag}`)
    const id = String(runs[0].databaseId)
    const watched = spawnSync('gh', ['run', 'watch', id, '--exit-status'], { stdio: 'inherit' })
    if (watched.status === 0) return
    const log = spawnSync('gh', ['run', 'view', id, '--log-failed'], { encoding: 'utf8' }).stdout ?? ''
    if (!isTransientDownloadFailure(log)) fail(`the release run failed (gh run view ${id} --log-failed)`)
    if (attempt >= MAX_RERUNS) fail(`the release run failed ${attempt + 1} times on download errors`)
    step('retry', `transient download error; re-running failed jobs (${attempt + 1} of ${MAX_RERUNS})`)
    gh('run', 'rerun', id, '--failed')
  }
}

async function main() {
  const flags = new Set(process.argv.slice(2))
  if (flags.has('--dry-run')) {
    PLAN.forEach((text, i) => console.log(`${i + 1}. ${text}`))
    console.log('dry run: nothing performed.')
    return
  }
  step(1, PLAN[0])
  if (sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') fail('not on main')
  if (sh('git', ['status', '--porcelain']) !== '') fail('the working tree is not clean')
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version
  const newest = changelogHeadings(readFileSync('CHANGELOG.md', 'utf8'))[0]?.version
  if (newest !== version) fail(`package.json is ${version} but the newest changelog heading is ${newest}`)
  const tag = `v${version}`

  step(2, PLAN[1])
  const tags = sh('git', ['tag', '--list', 'v*', '--sort=-v:refname']).split('\n').filter(Boolean)
  const releases = JSON.parse(gh('release', 'list', '--limit', '200', '--json', 'tagName')).map((r) => r.tagName)
  const gap = tagsWithoutRelease(tags, releases)
  if (gap.length > 0 && !flags.has('--allow-gap')) fail(`tags with no release: ${gap.join(', ')}. Fix them or pass --allow-gap.`)

  step(3, PLAN[2])
  if (!flags.has('--yes') && !(await confirm(`Push main and release ${tag}?`))) fail('cancelled')
  sh('git', ['push', 'origin', 'main'])
  const sha = sh('git', ['rev-parse', 'HEAD'])

  step(4, PLAN[3])
  await waitForCi(sha)

  step(5, PLAN[4])
  sh('git', ['tag', tag])
  sh('git', ['push', 'origin', tag])

  step(6, PLAN[5])
  watchRelease(tag)

  step(7, PLAN[6])
  const info = JSON.parse(gh('release', 'view', tag, '--json', 'isDraft,assets'))
  if (info.isDraft) fail(`${tag} is still a draft`)
  const missing = missingAssets(info.assets.map((a) => a.name))
  if (missing.length > 0) fail(`${tag} is missing assets: ${missing.join(', ')}`)
  console.log(`release: ${tag} is published with ${info.assets.length} assets.`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
}
