import { app, BrowserWindow, type Event } from 'electron'
import { CHANNELS, type TabTransfer } from '@shared/api'
import type { AppService } from '../../appService'
import { log } from '../../log/logger'
import { broadcast } from '../../windows/broadcast'
import { classifyActivity } from '@shared/activity'
import { resolveReportLayout } from '../../windows/reportLayoutGuard'
import { TabMover } from '../../windows/tabMover'
import { ActivityBroadcaster } from '../../terminals/activityBroadcaster'
import { PtyDataCoalescer } from '../../terminals/ptyDataCoalescer'
import { type TabRegistry, focusTab, type OpenTab } from '../../windows/tabRegistry'
import type { SessionLayoutStore } from '../../windows/sessionLayoutStore'
import type { LayoutFlushCoordinator } from '../../windows/layoutFlushCoordinator'
import type { Handlers, Listeners } from '../registrar'

/** How often, at most, the Active section's activity broadcast goes out while a pty is producing
 *  output. See `ActivityBroadcaster`. */
const ACTIVITY_BROADCAST_MS = 500

export interface TabsDeps {
  service: AppService
  sessionLayoutStore?: SessionLayoutStore | null
  layoutFlushCoordinator?: LayoutFlushCoordinator | null
  tabRegistry?: TabRegistry | null
  windowNumberFor?: (webContentsId: number) => number | null
  openDetachedWindow?: (tab: TabTransfer, at: { x: number; y: number }) => number
}

type HandledKeys = 'reportLayout' | 'activeTabs' | 'focusTab' | 'tabDropped' | 'tabAdoptHere' | 'tabDetach'
type ListenedKeys = 'reportTabs'

/**
 * Tabs, layout reporting and cross-window tab moves — see CLAUDE.md "Windows, and what belongs to
 * which" and "The tab registry and activity classification".
 */
export function tabsHandlers(deps: TabsDeps): {
  handlers: Pick<Handlers, HandledKeys>
  listeners: Pick<Listeners, ListenedKeys>
  dispose: () => void
} {
  const { service, sessionLayoutStore, layoutFlushCoordinator, tabRegistry, windowNumberFor, openDetachedWindow } = deps

  /**
   * Moving a session tab between windows, and coalescing pty activity into the Active section's
   * broadcasts — both pulled out into their own unit-tested classes (MAIN-13 step 3). See
   * `TabMover` and `ActivityBroadcaster` for why each is shaped the way it is.
   */
  const tabMover = new TabMover({
    getWindows: () => BrowserWindow.getAllWindows(),
    tabRegistry,
    pty: service.pty,
    openDetachedWindow,
    windowNumberFor,
  })
  const onWindowFocus = (_e: Event, win: BrowserWindow): void => { tabMover.rememberFocus(win.webContents.id) }
  app.on('browser-window-focus', onWindowFocus)

  // Not coalesced: a tab opening or closing is a user action, rare and immediately visible, and
  // delaying it by up to half a second would be felt.
  tabRegistry?.onChange(() => broadcast(CHANNELS.activeTabsChanged))

  const activity = new ActivityBroadcaster({
    onBroadcast: () => broadcast(CHANNELS.activeTabsChanged),
    intervalMs: ACTIVITY_BROADCAST_MS,
  })
  // Neither `PtyManager` nor `TabRegistry` can unsubscribe a listener today (MAIN-20, not in
  // scope here) — these subscriptions outlive a `dispose()` exactly as they did before this file
  // existed; a second `registerIpc` call in the same process (tests aside) would double them up.
  const ptyCoalescer = new PtyDataCoalescer({
    onFlush: (id, data) => broadcast(CHANNELS.ptyData, id, data),
  })
  service.pty.onData((id, data) => ptyCoalescer.push(id, data))
  service.pty.onExit((id, code) => broadcast(CHANNELS.ptyExit, id, code))
  // Activity coalescing still observes every raw chunk, not the coalesced flush — it only cares
  // that output happened, and the interval it broadcasts on (500ms) is coarser than the few
  // milliseconds `PtyDataCoalescer` ever delays a chunk by.
  service.pty.onData(() => activity.notify())
  service.pty.onExit(() => activity.notify())

  return {
    handlers: {
      reportLayout: (e, report) => {
        const resolved = resolveReportLayout(report, windowNumberFor?.(e.sender.id) ?? null)
        if (resolved === null) return
        sessionLayoutStore?.reportLayout(resolved)
        // Resolves `before-quit`'s bounded wait for this specific window, when one is in progress.
        layoutFlushCoordinator?.onReport(e.sender.id)
      },
      activeTabs: () => (tabRegistry?.list() ?? []).map((t) => ({
        windowNumber: t.windowNumber,
        key: t.key,
        view: t.view,
        label: t.label,
        status: classifyActivity(
          // The rendered screen, not the raw stream — see `classifyActivity` and `pty/screen.ts`.
          t.ptyId !== null ? service.pty.screen(t.ptyId) : '',
          t.ptyId !== null ? service.pty.lastOutputAt(t.ptyId) : 0,
          Date.now(),
          t.ptyId !== null && service.pty.has(t.ptyId),
        ),
      })),
      focusTab: (_e, windowNumber, key) => {
        focusTab(BrowserWindow.getAllWindows(), windowNumber, key)
      },
      tabDropped: (e, tab, at) => {
        // The guard has already checked `tab` is a well-formed `TabTransfer` (contract, MAIN-11).
        const { key } = tab
        const target = tabMover.windowUnder(at)
        // The whole decision, because this gesture shipped once doing nothing at all and there
        // was no way to tell from outside whether the drop had even been noticed.
        log.info('tabs', 'tab dropped', {
          at,
          from: e.sender.id,
          target: target?.webContents.id ?? null,
          outcome: target === null ? 'detach' : target.webContents.id === e.sender.id ? 'same-window' : 'move',
        })
        // Released over the window it came from — the transcript, the sidebar, anywhere that is
        // not a tab strip. Nothing happened, and tearing a window off for that would be a
        // surprise.
        if (target === null ? false : target.webContents.id === e.sender.id) return

        if (target !== null) {
          target.webContents.send(CHANNELS.tabAdopt, tab)
          tabMover.handOver(tab, tabMover.windowNumberFor(target.webContents.id))
          // Brought to the front: the tab is now there, and a move whose result is behind another
          // window looks exactly like a move that did not happen.
          target.focus()
          tabMover.announceClaimed(key, target.webContents.id)
          return
        }

        // Dropped on the desktop: a window of its own. Announced before the window is made — see
        // below.
        tabMover.announceClaimed(key, null)
        tabMover.handOver(tab, tabMover.openDetachedWindow(tab, at))
      },
      tabAdoptHere: (e, tab) => {
        log.info('tabs', 'tab dropped on a strip in another window', { to: e.sender.id })
        tabMover.announceClaimed(tab.key, e.sender.id)
        e.sender.send(CHANNELS.tabAdopt, tab)
        tabMover.handOver(tab, tabMover.windowNumberFor(e.sender.id))
      },
      tabDetach: (_e, tab, at) => {
        // Announced before the window is made, not after: the new window has not loaded its
        // renderer yet and so cannot hear anything, and a claim arriving once it *has* would tell
        // it to close the very tab it exists to show. Nothing is lost in the gap — the pty keeps
        // running whether or not a view is attached to it.
        tabMover.announceClaimed(tab.key, null)
        tabMover.handOver(tab, tabMover.openDetachedWindow(tab, at))
      },
    },
    listeners: {
      reportTabs: (e, tabs) => {
        const windowNumber = windowNumberFor?.(e.sender.id) ?? null
        if (windowNumber === null || !tabRegistry) return
        tabRegistry.report(windowNumber, tabs.map((t): OpenTab => ({ ...t, windowNumber })))
      },
    },
    dispose: () => {
      activity.dispose()
      ptyCoalescer.dispose()
      app.off('browser-window-focus', onWindowFocus)
    },
  }
}
