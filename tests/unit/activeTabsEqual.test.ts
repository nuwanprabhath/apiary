import { describe, it, expect } from 'vitest'
import { tabsEqual } from '../../src/renderer/state/activeTabsStore'
import type { ActiveTabPayload } from '@shared/api'

const tab = (over: Partial<ActiveTabPayload> = {}): ActiveTabPayload => ({
  windowNumber: 1,
  key: 'a',
  view: 'transcript',
  status: 'idle',
  label: null,
  ...over,
})

describe('tabsEqual (UI-4 step 1)', () => {
  it('is true for the same array', () => {
    const a = [tab()]
    expect(tabsEqual(a, a)).toBe(true)
  })

  it('is true when every field matches across a fresh array', () => {
    expect(tabsEqual([tab()], [tab()])).toBe(true)
  })

  it('is false when the length differs', () => {
    expect(tabsEqual([tab()], [tab(), tab({ key: 'b' })])).toBe(false)
  })

  it('is false when status changes — this is the case main broadcasts every ~500ms', () => {
    expect(tabsEqual([tab({ status: 'idle' })], [tab({ status: 'running' })])).toBe(false)
  })

  it('is false when label, view or key changes', () => {
    expect(tabsEqual([tab({ label: 'x' })], [tab({ label: 'y' })])).toBe(false)
    expect(tabsEqual([tab({ view: 'transcript' })], [tab({ view: 'terminal' })])).toBe(false)
    expect(tabsEqual([tab({ key: 'a' })], [tab({ key: 'b' })])).toBe(false)
  })

  it('is false when windowNumber changes', () => {
    expect(tabsEqual([tab({ windowNumber: 1 })], [tab({ windowNumber: 2 })])).toBe(false)
  })
})
