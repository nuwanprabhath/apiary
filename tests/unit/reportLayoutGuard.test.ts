import { describe, it, expect } from 'vitest'
import { resolveReportLayout } from '../../src/main/windows/reportLayoutGuard'

const layout = { preset: 'single' as const, panes: [] }

describe('resolveReportLayout', () => {
  it('stamps the report with the sender\'s own window number, ignoring what it claims', () => {
    // SEC-8: these records are auto-resumed at the next launch, so a window that could claim
    // another window's number could overwrite that window's stored layout, or revive `live`
    // sessions the sender never had open.
    const report = { number: 99, layout, live: [] }
    expect(resolveReportLayout(report, 2)).toEqual({ number: 2, layout, live: [] })
  })

  it('rejects when the sender has no resolvable window number', () => {
    const report = { number: 1, layout, live: [] }
    expect(resolveReportLayout(report, null)).toBeNull()
  })

  it('rejects a malformed report', () => {
    expect(resolveReportLayout({ not: 'a report' }, 1)).toBeNull()
    expect(resolveReportLayout(null, 1)).toBeNull()
    expect(resolveReportLayout('nope', 1)).toBeNull()
  })
})
