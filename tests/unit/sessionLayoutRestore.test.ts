import { describe, it, expect } from 'vitest'
import { pruneStaleLive } from '../../src/main/sessionLayoutRestore'
import type { WindowLayoutRecord } from '../../src/main/sessionLayoutStore'

const bounds = { x: 0, y: 0, width: 1400, height: 900 }
const record: WindowLayoutRecord = {
  number: 1,
  bounds,
  hasLayout: true,
  layout: {
    preset: 'halves-h',
    panes: [
      {
        id: 'col-1',
        activeTab: 'sess-live',
        tabs: [
          { key: 'sess-live', view: 'terminal', shells: [], activeShell: null },
          { key: 'sess-gone', view: 'terminal', shells: [], activeShell: null },
        ],
      },
    ],
  },
  live: ['sess-live', 'sess-gone'],
}

describe('pruneStaleLive', () => {
  it('drops a live entry whose session no longer resolves, keeping the tab', () => {
    const pruned = pruneStaleLive(record, (id) => id === 'sess-live')
    expect(pruned.live).toEqual(['sess-live'])
    // The tab itself survives — it just won't be auto-resumed; the user can still open it.
    expect(pruned.layout.panes[0].tabs.map((t) => t.key)).toEqual(['sess-live', 'sess-gone'])
  })

  it('drops every live entry when none resolve, without throwing', () => {
    const pruned = pruneStaleLive(record, () => false)
    expect(pruned.live).toEqual([])
  })

  it('is a no-op when every live entry still resolves', () => {
    const pruned = pruneStaleLive(record, () => true)
    expect(pruned).toEqual(record)
  })
})
