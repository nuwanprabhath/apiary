import { describe, it, expect } from 'vitest'
import { buildPersistedLayout, type LayoutLike } from '../../src/shared/layoutReport'

describe('buildPersistedLayout', () => {
  it('walks panes and tabs into the persisted shape, keyed by session id', () => {
    const layout: LayoutLike = {
      preset: 'halves-h',
      panes: [
        { id: 'col-1', activeKey: 'sess-1', tabs: [{ key: 'sess-1', view: 'terminal' }] },
        { id: 'col-2', activeKey: null, tabs: [] },
      ],
    }
    const shellTabs = new Map([['sess-1', [{ id: 'shell:sess-1:1', name: 'zsh' }]]])
    const activeTerminal = new Map([['sess-1', 'shell:sess-1:1']])

    expect(buildPersistedLayout(layout, shellTabs, activeTerminal, new Map())).toEqual({
      preset: 'halves-h',
      panes: [
        {
          id: 'col-1',
          activeTab: 'sess-1',
          tabs: [{
            key: 'sess-1',
            view: 'terminal',
            shells: [{ id: 'shell:sess-1:1', name: 'zsh' }],
            activeShell: 'shell:sess-1:1',
          }],
        },
        { id: 'col-2', activeTab: null, tabs: [] },
      ],
    })
  })

  it('looks up shells under the pty override id, not the tab key, for a still-pending session', () => {
    const layout: LayoutLike = {
      preset: 'single',
      panes: [{ id: 'col-1', activeKey: 'new:uuid-1', tabs: [{ key: 'new:uuid-1', view: 'terminal' }] }],
    }
    const shellTabs = new Map([['new:uuid-1', [{ id: 'shell:new:uuid-1:1', name: 'bash' }]]])
    const activeTerminal = new Map([['new:uuid-1', 'shell:new:uuid-1:1']])
    const ptyOverrides = new Map([['new:uuid-1', 'new:uuid-1']])

    const result = buildPersistedLayout(layout, shellTabs, activeTerminal, ptyOverrides)
    expect(result.panes[0].tabs[0].shells).toEqual([{ id: 'shell:new:uuid-1:1', name: 'bash' }])
    expect(result.panes[0].tabs[0].activeShell).toBe('shell:new:uuid-1:1')
  })

  it('defaults shells to an empty array and activeShell to null when nothing is known for the key', () => {
    const layout: LayoutLike = {
      preset: 'single',
      panes: [{ id: 'col-1', activeKey: 'sess-1', tabs: [{ key: 'sess-1', view: 'transcript' }] }],
    }
    const result = buildPersistedLayout(layout, new Map(), new Map(), new Map())
    expect(result.panes[0].tabs[0]).toEqual({
      key: 'sess-1', view: 'transcript', shells: [], activeShell: null,
    })
  })
})
