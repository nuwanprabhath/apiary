#!/usr/bin/env node
// Refuses to push a release tag until CI has passed on the commit it tags and no nightly failure is
// left open. Run by .husky/pre-push.
//
// The release workflow runs the same checks as CI, on Linux, before it builds anything. A tag
// pushed while CI on its commit was still running or had failed stops at those checks, publishes
// nothing, and the version has to be bumped again. A suite can pass on macOS and fail on Linux font
// widths, which only CI can see.
import { execFileSync } from 'node:child_process'

/**
 * What to do about a tag on a commit whose CI runs are `runs` (newest first, as `gh run list`
 * gives them): null to go ahead, or why not, naming what to do.
 */
export function ciVerdict(runs, sha) {
  const short = sha.slice(0, 8)
  const run = runs[0]
  if (run === undefined) return `CI has not run on ${short}. Push the branch (main) first, wait for CI to pass, then push the tag again.`
  if (run.status !== 'completed') return `CI on ${short} is still ${run.status}. Wait for it (gh run watch ${run.databaseId}), then push the tag again.`
  if (run.conclusion !== 'success') return `CI on ${short} ended "${run.conclusion}" (gh run view ${run.databaseId} --log-failed). Fix it on main and tag the fixed commit with a new version.`
  return null
}

/** The labels the scheduled runs file their failures under (nightly-e2e, nightly-slow, nightly-clock). */
const NIGHTLY = /^nightly-/

/**
 * What to do about a release while `issues` (open issues, as `gh issue list --json` gives them) are
 * open: null to go ahead, or which nightly failures are still unanswered. A nightly run files an
 * issue when it fails and closes it when it passes; a fix closes it from its commit ("Closes #43").
 */
export function nightlyVerdict(issues) {
  const open = issues.filter((i) => i.labels.some((l) => NIGHTLY.test(l.name)))
  if (open.length === 0) return null
  const list = open.map((i) => `#${String(i.number)} ${i.title}`).join('; ')
  return `nightly failures are still open: ${list}. Read each run, fix what it found (a flake is fixed, not rerun), close the issue from the fix's commit ("Closes #N"), then push the tag again.`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sha = process.argv[2]
  if (!sha) {
    console.error('usage: release-ci-gate.mjs <commit-sha>')
    process.exit(2)
  }
  let runs
  try {
    runs = JSON.parse(execFileSync('gh', ['run', 'list', '--workflow', 'ci.yml', '--commit', sha, '--limit', '5', '--json', 'databaseId,status,conclusion'], { encoding: 'utf8' }))
  } catch (error) {
    console.error(`pre-push: could not ask GitHub about CI on ${sha.slice(0, 8)} (${error.message.split('\n')[0]}). Install and sign in to gh, then push the tag again.`)
    process.exit(1)
  }
  let issues
  try {
    issues = JSON.parse(execFileSync('gh', ['issue', 'list', '--state', 'open', '--json', 'number,title,labels', '--limit', '50'], { encoding: 'utf8' }))
  } catch (error) {
    console.error(`pre-push: could not ask GitHub for open nightly issues (${error.message.split('\n')[0]}). Install and sign in to gh, then push the tag again.`)
    process.exit(1)
  }
  const nightly = nightlyVerdict(issues)
  if (nightly !== null) {
    console.error(`pre-push: the release tag is not pushed: ${nightly}`)
    process.exit(1)
  }
  const why = ciVerdict(runs, sha)
  if (why !== null) {
    console.error(`pre-push: the release tag is not pushed. ${why}`)
    process.exit(1)
  }
  console.log(`pre-push: CI passed on ${sha.slice(0, 8)}.`)
}
