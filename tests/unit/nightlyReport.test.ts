import { describe, expect, it } from 'vitest'

interface Result {
  failed: string[]
  flaky: string[]
}
interface NightlyReport {
  parseResults: (json: unknown) => Result
  mergeBody: (existing: string, os: string, result: Result, runUrl: string) => string
}

// A plain .mjs the workflow runs; its declaration file is outside this task's file list, so the
// module is typed here.
const script = '../../scripts/nightly-report.mjs'
const { mergeBody, parseResults } = (await import(/* @vite-ignore */ script)) as NightlyReport

const test = (projectName: string, status: string) => ({ projectName, status })
const report = {
  stats: { unexpected: 1, flaky: 1 },
  suites: [
    {
      suites: [
        { specs: [{ title: 'breaks', file: 'a.spec.ts', tests: [test('parallel', 'unexpected')] }] },
        {
          suites: [{ specs: [{ title: 'needed a retry', file: 'c.spec.ts', tests: [test('serial', 'flaky')] }] }],
          specs: [
            { title: 'fine', file: 'd.spec.ts', tests: [test('parallel', 'expected')] },
            { title: 'skipped', file: 'e.spec.ts', tests: [test('parallel', 'skipped')] },
          ],
        },
      ],
    },
  ],
}

describe('parseResults', () => {
  it('separates failed tests from tests that passed on retry, walking nested suites', () => {
    expect(parseResults(report)).toEqual({
      failed: ['a.spec.ts › breaks [parallel]'],
      flaky: ['c.spec.ts › needed a retry [serial]'],
    })
  })

  it('reports nothing for an empty report', () => {
    expect(parseResults({})).toEqual({ failed: [], flaky: [] })
  })
})

describe('mergeBody', () => {
  const bad = { failed: ['x'], flaky: [] }
  const clean = { failed: [], flaky: [] }

  it('keeps each OS in its own section and drops one that turns clean', () => {
    const both = mergeBody(mergeBody('', 'Linux', bad, 'run1'), 'macOS', bad, 'run1')
    expect(both).toContain('## Linux')
    expect(both).toContain('## macOS')
    const onlyMac = mergeBody(both, 'Linux', clean, 'run2')
    expect(onlyMac).not.toContain('## Linux')
    expect(mergeBody(onlyMac, 'macOS', clean, 'run2')).toBe('')
  })
})
