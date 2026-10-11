import { describe, it, expect, vi } from 'vitest'
import { VirtualContentsRegistry } from '../../src/main/remote/virtualContents'
import { tabsHandlers, type TabsDeps } from '../../src/main/ipc/handlers/tabs'

vi.mock('electron', () => ({
  app: { on: () => {}, off: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
}))

describe('a remote window\'s layout and tabs', () => {
  it('are never stored: reportLayout and reportTabs from a virtual window write nothing and do not throw', () => {
    const reportLayout = vi.fn()
    const report = vi.fn()
    const flush = vi.fn()
    const deps = {
      service: { pty: { onData: () => {}, onExit: () => {} } },
      state: {
        tabMover: {}, activity: { notify: () => {}, dispose: () => {} },
        ptyAttachments: {}, ptyCoalescer: { push: () => {}, dispose: () => {} },
      },
      sessionLayoutStore: { reportLayout },
      layoutFlushCoordinator: { onReport: flush },
      tabRegistry: { report, onChange: () => {} },
      // The window manager knows only real windows' ids: a virtual id has no number.
      windowNumberFor: () => null,
      activeTabs: {},
    } as unknown as TabsDeps
    const { handlers, listeners, dispose } = tabsHandlers(deps)
    const sender = new VirtualContentsRegistry().create(1, () => {})
    const layout = {
      number: 1, hasLayout: true, tabs: [], layout: null, panes: [], focused: null, activePane: null,
    }
    expect(() => handlers.reportLayout({ sender }, layout as never)).not.toThrow()
    expect(() => listeners.reportTabs({ sender }, [])).not.toThrow()
    expect(reportLayout).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
    dispose()
  })
})
