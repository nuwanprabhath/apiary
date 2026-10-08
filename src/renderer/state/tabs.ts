import type { ReportedTab, TabTransfer, WindowLayoutReport } from '@shared/domain/tabs'
import { background, surface } from './policy'

/** Tabs across windows: handing one to another window, and telling main what this one has open. */

type Point = { x: number; y: number }

export function dropTab(tab: TabTransfer, at: Point): void {
  surface(window.apiary.tabDropped(tab, at), 'Could not move this tab')
}
export function detachTab(tab: TabTransfer, at: Point): void {
  surface(window.apiary.tabDetach(tab, at), 'Could not open this session in a new window')
}
/** A tab dragged in from another window whose drop landed here. */
export function adoptTabHere(tab: TabTransfer): void {
  surface(window.apiary.tabAdoptHere(tab), 'Could not move this tab')
}
/** Brings another window's tab to the front. */
export function focusTabInWindow(windowNumber: number, key: string): void {
  surface(window.apiary.focusTab(windowNumber, key), 'Could not switch to that window')
}

/** The layout main persists for the next launch. A dropped report is retried by the next change. */
export function reportLayout(report: WindowLayoutReport): void {
  background(window.apiary.reportLayout(report), 'tabs')
}
/** What this window has open, for the Active section. */
export function reportTabs(tabs: ReportedTab[]): void { window.apiary.reportTabs(tabs) }

export const onTabAdopt = (cb: (tab: TabTransfer) => void): (() => void) => window.apiary.onTabAdopt(cb)
export const onTabClaimed = (cb: (key: string) => void): (() => void) => window.apiary.onTabClaimed(cb)
export const onSelectTab = (cb: (key: string) => void): (() => void) => window.apiary.onSelectTab(cb)
/** Main is about to quit and wants the layout now. */
export const onRequestLayoutFlush = (cb: () => void): (() => void) => window.apiary.onRequestLayoutFlush(cb)
