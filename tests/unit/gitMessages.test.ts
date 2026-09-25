import { describe, it, expect } from 'vitest'
import { pullMessage, pushMessage, worktreePullMessage, updateBranchMessage } from '../../src/shared/gitMessages'

describe('git messages', () => {
  it('says how many commits a pull brought, and when it brought none', () => {
    expect(pullMessage(0)).toBe('Already up to date.')
    expect(pullMessage(1)).toBe('Pulled 1 commit from upstream.')
    expect(pullMessage(12)).toBe('Pulled 12 commits from upstream.')
  })

  it('says how many commits a push sent, and whether it published the branch', () => {
    expect(pushMessage({ commits: 3, published: false })).toBe('Pushed 3 commits to upstream.')
    expect(pushMessage({ commits: 0, published: false })).toMatch(/^Nothing to push/)
    expect(pushMessage({ commits: 1, published: true })).toBe('Published the branch with 1 commit.')
    expect(pushMessage({ commits: 0, published: true })).toBe('Published the branch.')
  })

  it('names the branch and worktree for a pull made from the worktree dialog', () => {
    expect(worktreePullMessage('dev/1.0.12', 'dev-1.0.12', 4)).toBe('Pulled 4 commits into dev/1.0.12 in dev-1.0.12.')
    expect(worktreePullMessage('dev/1.0.12', 'dev-1.0.12', 0)).toBe('dev/1.0.12 in dev-1.0.12 is already up to date.')
  })
})

describe('updateBranchMessage', () => {
  it('names the branch and counts the commits', () => {
    expect(updateBranchMessage('main', 0)).toBe('main is already up to date.')
    expect(updateBranchMessage('feature/x', 1)).toBe('Pulled 1 commit into feature/x.')
    expect(updateBranchMessage('feature/x', 3)).toBe('Pulled 3 commits into feature/x.')
  })
})
