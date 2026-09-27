import { describe, it, expect } from 'vitest'
import { isWindowLayoutReport } from '@shared/types'

const valid = {
  number: 1,
  live: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
  layout: {
    preset: 'single',
    panes: [
      {
        id: 'pane-1',
        activeTab: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        tabs: [
          {
            key: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            view: 'transcript',
            shells: [{ id: '1', name: 'Terminal 1' }],
            activeShell: '1',
          },
        ],
      },
    ],
  },
}

// This validates untrusted `?restore=` URL input (see uiState.ts) the same way isTabTransfer
// validates `?transfer=`, so a malformed shape must be refused rather than crash the renderer.
describe('a window layout read out of a `?restore=` URL', () => {
  it('is accepted in its full shape, and with no panes at all', () => {
    expect(isWindowLayoutReport(valid)).toBe(true)
    expect(isWindowLayoutReport({ ...valid, layout: { preset: 'single', panes: [] } })).toBe(true)
  })

  it('is refused with the wrong top-level types', () => {
    expect(isWindowLayoutReport(null)).toBe(false)
    expect(isWindowLayoutReport('1')).toBe(false)
    expect(isWindowLayoutReport({ ...valid, number: '1' })).toBe(false)
    expect(isWindowLayoutReport({ ...valid, live: 'not-an-array' })).toBe(false)
    expect(isWindowLayoutReport({ ...valid, live: [1] })).toBe(false)
    expect(isWindowLayoutReport({ ...valid, layout: null })).toBe(false)
  })

  it('is refused with a malformed layout', () => {
    expect(isWindowLayoutReport({ ...valid, layout: { panes: [] } })).toBe(false)
    expect(isWindowLayoutReport({ ...valid, layout: { preset: 'single', panes: 'nope' } })).toBe(false)
  })

  it('is refused with a malformed pane', () => {
    const badPane = { ...valid, layout: { preset: 'single', panes: [{ tabs: [], activeTab: null }] } }
    expect(isWindowLayoutReport(badPane)).toBe(false)
  })

  it('is refused with a malformed tab inside a pane', () => {
    const badTab = {
      ...valid,
      layout: {
        preset: 'single',
        panes: [{ id: 'pane-1', activeTab: null, tabs: [{ key: 'k', view: 'sideways', shells: [], activeShell: null }] }],
      },
    }
    expect(isWindowLayoutReport(badTab)).toBe(false)
  })

  it('is refused with extra fields removed from what a tab needs (missing key)', () => {
    const missingKey = {
      ...valid,
      layout: {
        preset: 'single',
        panes: [{ id: 'pane-1', activeTab: null, tabs: [{ view: 'terminal', shells: [], activeShell: null }] }],
      },
    }
    expect(isWindowLayoutReport(missingKey)).toBe(false)
  })
})
