/**
 * Tabs, layout reports and windows in the fake, modelled on main's tab registry and tab mover: this
 * window (`THIS_WINDOW`) reports the tabs it has open, a tab torn off or dropped on the desktop is
 * announced as claimed to every window and filed under a window of its own, and a tab adopted here
 * is handed to this window. A tab whose session has a chat reads that chat's activity. Any other tab
 * keeps the status it was given, which a test sets through `fake.state.tabs`: the fake models chats,
 * not terminals, and stores no pty id to tell them apart. The contract (`tests/contract/clauses/tabs.ts`)
 * pins it.
 */
import type { ApiaryApi } from '@shared/api'
import { chatActivity } from '@shared/activity'
import type { ActiveTabPayload, TabTransfer } from '@shared/domain/tabs'
import { DETACHED_WINDOW_NUMBER, THIS_WINDOW } from '../../contract/world'
import type { Env } from './state'

type TabsApi = Pick<ApiaryApi,
  | 'reportLayout' | 'reportTabs' | 'activeTabs' | 'focusTab' | 'tabDropped' | 'tabDetach' | 'tabAdoptHere'>

export function tabsApi(env: Env): TabsApi {
  const { state, emit } = env
  const { x, y, width, height } = THIS_WINDOW.bounds
  const inThisWindow = (at: { x: number; y: number }): boolean => at.x >= x && at.x <= x + width && at.y >= y && at.y <= y + height

  /** Files a moved tab under `windowNumber` right away, ahead of that window's own report. */
  const handOver = (tab: TabTransfer, windowNumber: number): void => {
    const moved: ActiveTabPayload = { windowNumber, key: tab.key, view: tab.view, status: 'stopped', label: null }
    state.tabs = [...state.tabs.filter((t) => t.key !== tab.key), moved]
    emit('activeTabsChanged')
  }
  const tearOff = (tab: TabTransfer): void => {
    emit('tabClaimed', tab.key)
    handOver(tab, DETACHED_WINDOW_NUMBER)
  }

  return {
    reportLayout: async () => {},
    reportTabs: (tabs) => {
      const mine = tabs.map((t): ActiveTabPayload => ({ windowNumber: THIS_WINDOW.number, key: t.key, view: t.view, status: 'stopped', label: t.label }))
      state.tabs = [...mine, ...state.tabs.filter((t) => t.windowNumber !== THIS_WINDOW.number)]
      emit('activeTabsChanged')
    },
    activeTabs: async () => state.tabs.map((t) => {
      const chat = state.chats.get(t.key)
      return chat === undefined ? t : { ...t, status: chatActivity(chat) }
    }),
    focusTab: async (windowNumber, key) => { if (windowNumber === THIS_WINDOW.number) emit('selectTab', key) },
    tabDropped: async (tab, at) => { if (!inThisWindow(at)) tearOff(tab) },
    tabDetach: async (tab) => { tearOff(tab) },
    // Dropped on a strip in this window: the tab is handed here, and nobody is told it was claimed.
    tabAdoptHere: async (tab) => {
      emit('tabAdopt', tab)
      handOver(tab, THIS_WINDOW.number)
    },
  }
}
