import { describe, it, expect } from 'vitest'
import { push, versionsToAnnotate, isTransientDownloadFailure, tagsWithoutRelease, missingAssets, outstanding, awaitRun, waitForCi } from '../../scripts/release.mjs'

const CHANGELOG = `# Changelog

## [1.60.6] - 2026-11-10

## [1.60.5] - 2026-11-10 (not released; shipped in 1.60.x)

## [1.60.4] - 2026-11-10

## [1.60.0] - 2026-11-09

## [1.59.0] - 2026-11-01
`

describe('release script', () => {
  it('annotates an unannotated version that has no tag once a later one shipped', () => {
    expect(versionsToAnnotate(CHANGELOG, ['v1.60.0', 'v1.59.0', 'v1.60.6'])).toEqual([{ version: '1.60.4', shippedIn: '1.60.6' }])
  })

  it('leaves the newest unreleased version alone', () => {
    expect(versionsToAnnotate(CHANGELOG, ['v1.60.0', 'v1.59.0'])).toEqual([])
  })

  it('tells a transient download error from a real failure', () => {
    expect(isTransientDownloadFailure('Error: Response code 503 (Service Unavailable)')).toBe(true)
    expect(isTransientDownloadFailure('download failed: ETIMEDOUT')).toBe(true)
    expect(isTransientDownloadFailure('read ECONNRESET')).toBe(true)
    expect(isTransientDownloadFailure('FAIL tests/unit/x.test.ts')).toBe(false)
  })

  it('lists tags with no release and missing assets', () => {
    expect(tagsWithoutRelease(['v2', 'v1'], ['v1'])).toEqual(['v2'])
    expect(missingAssets(['a.dmg', 'a.zip', 'latest-mac.yml', 'a.AppImage', 'a.deb'])).toHaveLength(3)
    expect(missingAssets(['a.dmg', 'a.zip', 'latest-mac.yml', 'latest-mac.yml.sig', 'a.AppImage', 'a.deb', 'latest-linux.yml', 'latest-linux.yml.sig'])).toEqual([])
  })
})

describe('what a release still has to fold in', () => {
  it('lists every open issue and pull request, and the due quality skills', () => {
    const lines = outstanding({
      issues: [{ number: 46, title: 'Nightly e2e: failing or flaky tests' }, { number: 50, title: 'A bug report' }],
      prs: [{ number: 51, title: 'chore(deps): bump vite' }],
      due: ['correct: 42 commits since its last run (due every 40)'],
    })
    expect(lines).toEqual([
      'issue #46 Nightly e2e: failing or flaky tests',
      'issue #50 A bug report',
      'pull request #51 chore(deps): bump vite',
      'quality skill due: correct: 42 commits since its last run (due every 40)',
    ])
  })

  it('is empty when nothing is open or due', () => {
    expect(outstanding({ issues: [], prs: [], due: [] })).toEqual([])
  })
})

describe('finding the release run a tag push started', () => {
  it('asks again while GitHub lists no run yet, then takes the first', async () => {
    const answers: { databaseId: number }[][] = [[], [], [{ databaseId: 7 }]]
    let waits = 0
    const run = await awaitRun(() => answers.shift() ?? [], async () => { waits++ }, 5)
    expect(run).toEqual({ databaseId: 7 })
    expect(waits).toBe(2)
  })

  it('gives up after its tries, without a wait after the last', async () => {
    let waits = 0
    await expect(awaitRun(() => [], async () => { waits++ }, 3)).resolves.toBeNull()
    expect(waits).toBe(2)
  })
})

describe('waiting for CI on the pushed commit', () => {
  const SHA = '82f80d820972ec94b5335477dc758a42cd5cdd09'
  type Run = { databaseId: number; status: string; conclusion: string }

  it('waits for GitHub to list the run, watches it, and passes once it succeeds', async () => {
    const seen: Run[][] = [[], [], [{ databaseId: 7, status: 'in_progress', conclusion: '' }], [{ databaseId: 7, status: 'in_progress', conclusion: '' }]]
    const done: Run[] = [{ databaseId: 7, status: 'completed', conclusion: 'success' }]
    const watched: number[] = []
    const list = (): Run[] => seen.shift() ?? done
    expect(await waitForCi(SHA, list, (id) => { watched.push(id) }, async () => {})).toBeNull()
    expect(watched).toEqual([7])
  })

  it('says why when the run fails, and when none ever starts', async () => {
    const failed = [{ databaseId: 8, status: 'completed', conclusion: 'failure' }]
    expect(await waitForCi(SHA, () => failed, () => {}, async () => {})).toContain('ended "failure"')
    expect(await waitForCi(SHA, () => [], () => {}, async () => {})).toContain('CI has not run on 82f80d82')
  })
})

describe('pushing a ref', () => {
  // A refused tag push left only "failed to push some refs": the hook's report was captured and dropped.
  it('shows git and the hook their terminal, and says which push failed', () => {
    const calls: unknown[][] = []
    const refused = push('v1.89.0', (...args) => { calls.push(args); return { status: 1 } })
    expect(calls).toEqual([['git', ['push', 'origin', 'v1.89.0'], { stdio: 'inherit' }]])
    expect(refused).toBe("git push origin v1.89.0 failed (exit 1); the pre-push hook's report is above")
    expect(push('main', () => ({ status: 0 }))).toBeNull()
  })
})
