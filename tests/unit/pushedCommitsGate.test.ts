import { describe, it, expect } from 'vitest'
import { pushedCommitProblems, pushedRanges } from '../../scripts/pushed-commits-gate.mjs'

const ME = 'maintainer@users.noreply.github.com'
const commit = (over: Partial<{ sha: string; authorEmail: string; committerEmail: string; message: string }>) => ({
  sha: 'e288907c00000000000000000000000000000000',
  authorEmail: ME,
  committerEmail: ME,
  message: 'refactor(tests): prove presence at indexed access in tests/contract\n',
  ...over,
})

describe('a push carries no commit made under a test identity or with AI attribution', () => {
  it('lets an ordinary commit go', () => {
    expect(pushedCommitProblems([commit({})])).toEqual([])
  })

  it('refuses the 1.60 commits made as the fixtures\' Test <test@example.com>, once per commit', () => {
    const problems = pushedCommitProblems([commit({ authorEmail: 'test@example.com', committerEmail: 'test@example.com' })])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/^e288907c .*test@example\.com, a test fixture's identity.*git config --local user\.email/)
  })

  it('refuses the agent commit that reached main with a Co-Authored-By: Claude trailer, and the PR footer', () => {
    const trailer = commit({ message: 'refactor(tests): x\n\nNo-Red-Test-Reason: refactor\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\n' })
    expect(pushedCommitProblems([trailer])).toEqual([expect.stringMatching(/carries AI attribution/)])
    const footer = commit({ message: 'docs: y\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n' })
    expect(pushedCommitProblems([footer])).toHaveLength(1)
  })

  it('does not mistake a commit about Claude Code for attribution', () => {
    expect(pushedCommitProblems([commit({ message: 'feat(transcript): one typed decoder for a Claude Code JSONL entry\n' })])).toEqual([])
  })

  it('reads the ranges from pre-push stdin: an update, a new branch, and a delete (skipped)', () => {
    const z = '0'.repeat(40)
    const stdin = [
      `refs/heads/main ${'b'.repeat(40)} refs/heads/main ${'a'.repeat(40)}`,
      `refs/heads/new ${'c'.repeat(40)} refs/heads/new ${z}`,
      `(delete) ${z} refs/heads/old ${'d'.repeat(40)}`,
      '',
    ].join('\n')
    expect(pushedRanges(stdin)).toEqual([[`${'a'.repeat(40)}..${'b'.repeat(40)}`], ['c'.repeat(40), '--not', '--remotes']])
  })
})
