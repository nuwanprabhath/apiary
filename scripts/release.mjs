#!/usr/bin/env node
// One command for a release: checks, push main, wait for CI, tag, watch the release run, retry
// transient download failures, check the published release. `--dry-run` prints the plan only.
//
//   node scripts/release.mjs [--check] [--dry-run] [--yes] [--allow-gap] [--allow-open]
//
// `--check` lists what the release still has to fold in (open issues and pull requests, due quality
// skills) and fails while anything is listed; a release refuses in the same state unless
// `--allow-open` says the maintainer chose to leave those open.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { ciVerdict } from './release-ci-gate.mjs'
import { dueNow } from './quality-cadence.mjs'

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

/**
 * Pushes `ref` with git's and the pre-push hook's output on screen, and says why it failed, or null.
 * Run through `sh`, the hook's report (lint, tests, the CI and nightly gates) was swallowed, and a
 * refused tag left only "failed to push some refs".
 * @param {string} ref
 * @param {(cmd: string, args: string[], opts: { stdio: 'inherit' }) => { status: number | null }} run
 * @returns {string | null}
 */
export function push(ref, run = spawnSync) {
  const { status } = run('git', ['push', 'origin', ref], { stdio: 'inherit' })
  return status === 0 ? null : `git push origin ${ref} failed (exit ${String(status)}); the pre-push hook's report is above`
}
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

/**
 * What a release still has to fold in: every open issue and pull request (a release fixes or answers
 * them, Dependabot's included) and every quality skill that is due. One line each; empty when none.
 * @param {{ issues: { number: number, title: string }[], prs: { number: number, title: string }[], due: string[] }} o
 * @returns {string[]}
 */
export function outstanding(o) {
  return [
    ...o.issues.map((i) => `issue #${String(i.number)} ${i.title}`),
    ...o.prs.map((p) => `pull request #${String(p.number)} ${p.title}`),
    ...o.due.map((d) => `quality skill due: ${d}`),
  ]
}

function outstandingNow() {
  const list = (kind) => JSON.parse(gh(kind, 'list', '--state', 'open', '--limit', '50', '--json', 'number,title'))
  return outstanding({ issues: list('issue'), prs: list('pr'), due: dueNow() })
}

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

const fiveSeconds = () => new Promise((resolve) => setTimeout(resolve, 5000))

/**
 * Waits for CI on `sha` to finish, and resolves with why it cannot release, or null once it passed.
 * GitHub lists the run a push started only some seconds later, so it first waits up to three minutes
 * for one to appear: looking once straight after the push finds none and stops the release.
 * @param {string} sha
 * @param {() => { databaseId: number, status: string, conclusion: string }[]} list
 * @param {(id: number) => void} watch
 * @param {() => Promise<void>} wait
 * @returns {Promise<string | null>}
 */
export async function waitForCi(sha, list, watch, wait = fiveSeconds) {
  for (;;) {
    await awaitRun(list, wait, 36)
    const runs = list()
    if (runs[0] !== undefined && runs[0].status !== 'completed') {
      watch(runs[0].databaseId)
      continue
    }
    return ciVerdict(runs, sha)
  }
}

/**
 * The first run `list` returns, asking again after `wait()` while it returns none: GitHub lists the
 * run a tag push starts some seconds after the push, so one look straight after it found nothing.
 * @template T
 * @param {() => T[]} list
 * @param {() => Promise<void>} wait
 * @param {number} tries
 * @returns {Promise<T | null>}
 */
export async function awaitRun(list, wait, tries) {
  for (let i = 0; i < tries; i++) {
    const first = list()[0]
    if (first !== undefined) return first
    if (i < tries - 1) await wait()
  }
  return null
}

async function watchRelease(tag) {
  const listRuns = () => JSON.parse(gh('run', 'list', '--workflow', 'release.yml', '--branch', tag, '--limit', '1', '--json', 'databaseId'))
  for (let attempt = 0; ; attempt++) {
    const run = await awaitRun(listRuns, () => new Promise((resolve) => setTimeout(resolve, 5000)), 36)
    if (run === null) fail(`no release run started for ${tag} within 3 minutes`)
    const id = String(run.databaseId)
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
  if (flags.has('--check')) {
    const open = outstandingNow()
    if (open.length === 0) { console.log('release: nothing left to fold in.'); return }
    console.log(`release: fold these in, or tell the maintainer why they stay open:\n${open.map((l) => `- ${l}`).join('\n')}`)
    process.exit(1)
  }
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
  const open = outstandingNow()
  if (open.length > 0 && !flags.has('--allow-open')) fail(`still to fold in: ${open.join('; ')}. Fix them, or pass --allow-open once the maintainer chose to leave them.`)
  const tag = `v${version}`

  step(2, PLAN[1])
  const tags = sh('git', ['tag', '--list', 'v*', '--sort=-v:refname']).split('\n').filter(Boolean)
  const releases = JSON.parse(gh('release', 'list', '--limit', '200', '--json', 'tagName')).map((r) => r.tagName)
  const gap = tagsWithoutRelease(tags, releases)
  if (gap.length > 0 && !flags.has('--allow-gap')) fail(`tags with no release: ${gap.join(', ')}. Fix them or pass --allow-gap.`)

  step(3, PLAN[2])
  if (!flags.has('--yes') && !(await confirm(`Push main and release ${tag}?`))) fail('cancelled')
  const mainRefused = push('main')
  if (mainRefused !== null) fail(mainRefused)
  const sha = sh('git', ['rev-parse', 'HEAD'])

  step(4, PLAN[3])
  const ciRuns = () => JSON.parse(gh('run', 'list', '--workflow', 'ci.yml', '--commit', sha, '--limit', '5', '--json', 'databaseId,status,conclusion'))
  const watchRun = (id) => { spawnSync('gh', ['run', 'watch', String(id), '--exit-status'], { stdio: 'inherit' }) }
  const why = await waitForCi(sha, ciRuns, watchRun)
  if (why !== null) fail(why)

  step(5, PLAN[4])
  sh('git', ['tag', tag])
  const tagRefused = push(tag)
  if (tagRefused !== null) fail(`${tagRefused}. The tag ${tag} exists locally; once it is fixed, \`git push origin ${tag}\` and watch the release run.`)

  step(6, PLAN[5])
  await watchRelease(tag)

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
