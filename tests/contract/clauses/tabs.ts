import { describe, expect, it } from 'vitest'
import type { ReportedTab, TabTransfer, WindowLayoutReport } from '@shared/domain/tabs'
import { STANDARD_SESSIONS as STD } from '../../fixtures/standard'
import type { Ctx } from '../support'
import { DETACHED_WINDOW_NUMBER, INSIDE_THIS_WINDOW, OUTSIDE_EVERY_WINDOW, THIS_WINDOW } from '../world'

const tab = (key: string, over: Partial<ReportedTab> = {}): ReportedTab => ({ key, view: 'transcript', ptyId: null, label: null, ...over })
const transfer = (key: string): TabTransfer => ({ key, view: 'terminal', ptyId: null, shells: [], activeShell: null })
const LAYOUT: WindowLayoutReport = {
  number: THIS_WINDOW.number,
  layout: { preset: 'single', panes: [{ id: 'p1', tabs: [{ key: STD.csv.id, view: 'transcript', shells: [], activeShell: null }], activeTab: STD.csv.id }] },
  live: [],
}

export function defineTabClauses(ctx: Ctx): void {
  describe('tabs and layout', () => {
    it('lists nothing open until a window reports its tabs, then what it reported, with an activity for each, and says when that changes', async () => {
      expect(await ctx.api.activeTabs()).toEqual([])
      ctx.api.reportTabs([tab(STD.csv.id), tab('new:pending', { view: 'terminal', label: 'Pending session' })])
      expect(await ctx.api.activeTabs()).toEqual([
        { windowNumber: THIS_WINDOW.number, key: STD.csv.id, view: 'transcript', status: 'stopped', label: null },
        { windowNumber: THIS_WINDOW.number, key: 'new:pending', view: 'terminal', status: 'stopped', label: 'Pending session' },
      ])
      expect(ctx.heard.count('activeTabsChanged')).toBe(1)
    })

    it('each report replaces the last: a tab left out of it is closed', async () => {
      ctx.api.reportTabs([tab(STD.csv.id), tab(STD.switcher.id)])
      ctx.api.reportTabs([tab(STD.switcher.id)])
      expect((await ctx.api.activeTabs()).map((t) => t.key)).toEqual([STD.switcher.id])
      ctx.api.reportTabs([])
      expect(await ctx.api.activeTabs()).toEqual([])
    })

    it('drops a report that is not a list of tabs', async () => {
      ctx.api.reportTabs([tab(STD.csv.id)])
      ctx.api.reportTabs('everything' as never)
      ctx.api.reportTabs([{ key: 5 }] as never)
      expect((await ctx.api.activeTabs()).map((t) => t.key)).toEqual([STD.csv.id])
    })

    it('takes a layout report, and refuses one that is malformed', async () => {
      await ctx.api.reportLayout(LAYOUT)
      await expect(ctx.api.reportLayout({ ...LAYOUT, layout: { preset: 'single', panes: 'none' } } as never)).rejects.toThrow()
      await expect(ctx.api.reportLayout({ number: 'one' } as never)).rejects.toThrow()
    })

    it('focusing a tab of this window tells it to select that tab; another window\'s number reaches nobody', async () => {
      await ctx.api.focusTab(THIS_WINDOW.number, STD.csv.id)
      expect(ctx.heard.payloads('selectTab')).toEqual([[STD.csv.id]])
      await ctx.api.focusTab(41, STD.csv.id)
      expect(ctx.heard.count('selectTab')).toBe(1)
    })

    it('adopting a tab here hands it to this window and tells it to open it, without telling this window it lost it', async () => {
      await ctx.api.tabAdoptHere(transfer('tab-from-elsewhere'))
      expect(ctx.heard.payloads('tabAdopt')).toEqual([[transfer('tab-from-elsewhere')]])
      expect(ctx.heard.count('tabClaimed')).toBe(0)
      expect((await ctx.api.activeTabs()).map((t) => [t.windowNumber, t.key, t.view])).toEqual([
        [THIS_WINDOW.number, 'tab-from-elsewhere', 'terminal'],
      ])
      expect(ctx.heard.count('activeTabsChanged')).toBeGreaterThan(0)
    })

    it('tearing a tab off into a window of its own tells every window it was claimed and files it under the new window', async () => {
      ctx.api.reportTabs([tab(STD.csv.id)])
      await ctx.api.tabDetach(transfer(STD.csv.id), OUTSIDE_EVERY_WINDOW)
      expect(ctx.heard.payloads('tabClaimed')).toEqual([[STD.csv.id]])
      expect((await ctx.api.activeTabs()).map((t) => [t.windowNumber, t.key])).toEqual([[DETACHED_WINDOW_NUMBER, STD.csv.id]])
    })

    it('dropping a tab on the desktop does the same; dropping it back on its own window does nothing', async () => {
      ctx.api.reportTabs([tab(STD.csv.id)])
      await ctx.api.tabDropped(transfer(STD.csv.id), INSIDE_THIS_WINDOW)
      expect(ctx.heard.count('tabClaimed')).toBe(0)
      expect((await ctx.api.activeTabs()).map((t) => t.windowNumber)).toEqual([THIS_WINDOW.number])

      await ctx.api.tabDropped(transfer(STD.csv.id), OUTSIDE_EVERY_WINDOW)
      expect(ctx.heard.payloads('tabClaimed')).toEqual([[STD.csv.id]])
      expect((await ctx.api.activeTabs()).map((t) => t.windowNumber)).toEqual([DETACHED_WINDOW_NUMBER])
    })

    it('refuses a tab it cannot make sense of', async () => {
      await expect(ctx.api.tabDetach({ key: '' } as never, OUTSIDE_EVERY_WINDOW)).rejects.toThrow()
      await expect(ctx.api.tabDropped(transfer('k'), { x: 'left', y: 0 } as never)).rejects.toThrow()
      await expect(ctx.api.tabAdoptHere({ ...transfer('k'), view: 'sideways' } as never)).rejects.toThrow()
      expect(ctx.heard.count('tabClaimed')).toBe(0)
    })
  })
}
