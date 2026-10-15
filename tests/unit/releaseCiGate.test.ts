import { describe, it, expect } from 'vitest'
import { ciVerdict } from '../../scripts/release-ci-gate.mjs'

const SHA = '334387d5c0ffee00000000000000000000000000'

describe('a release tag waits for CI on its commit', () => {
  it('goes ahead only when the latest CI run on the commit passed', () => {
    expect(ciVerdict([{ databaseId: 1, status: 'completed', conclusion: 'success' }], SHA)).toBeNull()
  })

  it('refuses while CI is still running, as when 1.41.0 was tagged straight after the push to main', () => {
    expect(ciVerdict([{ databaseId: 38547215080, status: 'in_progress', conclusion: '' }], SHA))
      .toBe('CI on 334387d5 is still in_progress. Wait for it (gh run watch 38547215080), then push the tag again.')
  })

  it('refuses a commit whose CI failed, or that CI never ran on', () => {
    expect(ciVerdict([{ databaseId: 2, status: 'completed', conclusion: 'failure' }], SHA)).toMatch(/ended "failure".*new version/)
    expect(ciVerdict([], SHA)).toMatch(/has not run on 334387d5/)
  })
})
