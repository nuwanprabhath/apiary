#!/usr/bin/env node
// When the quality skills are due: trim-comments, correct, maintain-verify-apiary,
// architecture-drift and prune-tests. A skill owes a run after a number of commits or days, and a
// release tag is refused while one is owed (.husky/pre-push). The ledger is
// docs/quality-cadence.json; a skill's last step records its run with `done <skill>`.
//
//   node scripts/quality-cadence.mjs            what is due (exit 0)
//   node scripts/quality-cadence.mjs check      exit 1 when anything is due (the release gate)
//   node scripts/quality-cadence.mjs hook       the SessionStart hook's JSON (nothing when nothing is due)
//   node scripts/quality-cadence.mjs done <skill>   record a run at HEAD, today
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LEDGER = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'quality-cadence.json')
const DAY_MS = 24 * 60 * 60 * 1000
/** Days alone do not make a skill due on a repo that barely moved. */
const MIN_COMMITS_FOR_DAYS = 5

/**
 * Whether `skill` is due, given the commits since its last run (null when that commit is not on
 * this branch, which counts as due) and the days since. Returns why, or null when it is not due.
 */
export function dueReason(name, skill, commitsSince, daysSince) {
  const { commits, days } = skill.every
  if (commitsSince === null) return `${name}: its last run (${skill.last.commit.slice(0, 8)}) is not on this branch`
  if (commitsSince >= commits) return `${name}: ${String(commitsSince)} commits since its last run (due every ${String(commits)})`
  if (daysSince >= days && commitsSince >= MIN_COMMITS_FOR_DAYS) {
    return `${name}: ${String(Math.floor(daysSince))} days and ${String(commitsSince)} commits since its last run (due every ${String(days)} days)`
  }
  return null
}

/** The message a due skill gets: what is due and how to clear it. */
export function dueMessage(reasons) {
  return [
    `Quality skills due: ${reasons.join('; ')}.`,
    'Run each with its skill (.claude/skills/<name>/SKILL.md); its last step records the run with `node scripts/quality-cadence.mjs done <name>`, committed with its work.',
  ].join(' ')
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

function commitsSince(commit) {
  try {
    git('merge-base', '--is-ancestor', commit, 'HEAD')
  } catch {
    return null
  }
  return Number(git('rev-list', '--count', '--no-merges', `${commit}..HEAD`))
}

function reasonsNow(ledger, now) {
  return Object.entries(ledger.skills).flatMap(([name, skill]) => {
    const why = dueReason(name, skill, commitsSince(skill.last.commit), (now - Date.parse(skill.last.date)) / DAY_MS)
    return why === null ? [] : [why]
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command = 'status', name] = process.argv.slice(2)
  const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'))
  if (command === 'done') {
    if (!name || !(name in ledger.skills)) {
      console.error(`usage: quality-cadence.mjs done <${Object.keys(ledger.skills).join('|')}>`)
      process.exit(2)
    }
    ledger.skills[name].last = { commit: git('rev-parse', 'HEAD'), date: new Date().toISOString().slice(0, 10) }
    writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`)
    console.log(`quality-cadence: recorded ${name} at ${ledger.skills[name].last.commit.slice(0, 8)}; commit docs/quality-cadence.json with the run.`)
    process.exit(0)
  }
  const reasons = reasonsNow(ledger, Date.now())
  if (command === 'hook') {
    if (reasons.length > 0) {
      const context = `${dueMessage(reasons)} A release tag is refused until they have run, so tell the maintainer and offer to run them.`
      console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }))
    }
    process.exit(0)
  }
  if (reasons.length === 0) {
    console.log('quality-cadence: nothing due.')
    process.exit(0)
  }
  console.error(dueMessage(reasons))
  process.exit(command === 'check' ? 1 : 0)
}
