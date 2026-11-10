import { describe, expect, it } from 'vitest'

interface Result {
  failed: string[]
  flaky: string[]
}
interface NightlyReport {
  parseJunit: (xml: string) => Result
  mergeBody: (existing: string, os: string, result: Result, runUrl: string) => string
}

// A plain .mjs the workflow runs; its declaration file is outside this task's file list, so the
// module is typed here.
const script = '../../scripts/nightly-report.mjs'
const { mergeBody, parseJunit } = (await import(/* @vite-ignore */ script)) as NightlyReport

const junit = `<testsuites><testsuite name="e2e">
<testcase classname="a.spec.ts" name="breaks &amp; burns"><failure message="x"/></testcase>
<testcase classname="a.spec.ts" name="breaks &amp; burns"><failure message="x"/></testcase>
<testcase classname="b.spec.ts" name="also breaks"><failure message="y"/></testcase>
<testcase classname="c.spec.ts" name="needed a retry"><failure message="z"/></testcase>
<testcase classname="c.spec.ts" name="needed a retry"/>
<testcase classname="d.spec.ts" name="fine"/>
<testcase classname="e.spec.ts" name="skipped"><skipped/></testcase>
</testsuite></testsuites>`

describe('parseJunit', () => {
  it('separates failed titles from titles that passed on retry', () => {
    expect(parseJunit(junit)).toEqual({
      failed: ['a.spec.ts › breaks & burns', 'b.spec.ts › also breaks'],
      flaky: ['c.spec.ts › needed a retry'],
    })
  })

  it('reports a flakyFailure marker as flaky', () => {
    const xml = '<testcase classname="f" name="t"><flakyFailure message="m"/></testcase>'
    expect(parseJunit(xml)).toEqual({ failed: [], flaky: ['f › t'] })
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
