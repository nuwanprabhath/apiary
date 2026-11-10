#!/usr/bin/env node
// Refuses to push commits made under a test fixture's identity or carrying AI attribution. Run by
// .husky/pre-push with the hook's stdin, and by CI over the pushed range.
//
// commit-msg rejects AI attribution, but only where the hooks ran: three agent commits in a
// worktree reached main with a Co-Authored-By: Claude trailer. And a `git bisect run` of the e2e
// suite wrote the fixtures' `Test <test@example.com>` into the repo's own config, so 27 commits went
// out under it. A push is the last point both are still cheap to fix (amend or rebase, not a
// rewrite of main).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const ATTRIBUTION = /^co-authored-by:.*(claude|anthropic|openai|copilot)|generated with \[?claude/im
const FIXTURE_EMAIL = /@example\.(com|org|net)$/i
const ZERO = /^0+$/

/**
 * What is wrong with `commits` ({ sha, authorEmail, committerEmail, message }): one line per
 * problem, each naming the commit and the fix. Empty when they may go.
 */
export function pushedCommitProblems(commits) {
  const problems = []
  for (const c of commits) {
    const short = c.sha.slice(0, 8)
    const subject = c.message.split('\n')[0]
    for (const email of new Set([c.authorEmail, c.committerEmail])) {
      if (FIXTURE_EMAIL.test(email)) {
        problems.push(`${short} "${subject}" was made as ${email}, a test fixture's identity. Check \`git config --local user.email\` (a test that inherited GIT_DIR writes it), unset it, then rewrite the commit's author (git rebase -i --exec 'git commit --amend --no-edit --reset-author').`)
      }
    }
    if (ATTRIBUTION.test(c.message)) {
      problems.push(`${short} "${subject}" carries AI attribution. Remove the trailer (git rebase -i, reword) and push again.`)
    }
  }
  return problems
}

/** The commit ranges a pre-push stdin (`<local ref> <local sha> <remote ref> <remote sha>` lines) sends. */
export function pushedRanges(stdin) {
  const ranges = []
  for (const line of stdin.split('\n')) {
    const [, localSha, , remoteSha] = line.trim().split(/\s+/)
    if (localSha === undefined || remoteSha === undefined || ZERO.test(localSha)) continue
    ranges.push(ZERO.test(remoteSha) ? [localSha, '--not', '--remotes'] : [`${remoteSha}..${localSha}`])
  }
  return ranges
}

const SEP = '\u001e'

function commitsIn(range) {
  const out = execFileSync('git', ['log', `--format=%H%x1f%ae%x1f%ce%x1f%B${SEP}`, ...range], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return out.split(SEP).map((r) => r.trim()).filter((r) => r !== '').map((r) => {
    const [sha = '', authorEmail = '', committerEmail = '', message = ''] = r.split('\u001f')
    return { sha, authorEmail, committerEmail, message }
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // `--range <a..b>` (CI) or the pre-push lines on stdin.
  const ranges = process.argv[2] === '--range'
    ? [[process.argv[3] ?? '']]
    : pushedRanges(readFileSync(0, 'utf8'))
  const problems = ranges.flatMap((r) => pushedCommitProblems(commitsIn(r)))
  if (problems.length > 0) {
    console.error(`pushed-commits-gate: ${String(problems.length)} problem(s); nothing was pushed.\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
}
