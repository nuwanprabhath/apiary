import type { StatusBarItem } from '@shared/domain/statusBar'
import type { StatusBarPanel } from '@shared/domain/statusBar'
import { createIpcStore } from './createIpcStore'
import { surface } from './policy'

/** The status-bar plugins' items, re-read whenever main says they changed. Push-driven: the
 *  plugins keep their own schedules in main, so nothing here polls. A bar with nothing on it is the
 *  honest answer while a read fails (the failure is logged). */
const statusBarStore = createIpcStore<StatusBarItem[]>({
  scope: 'status-bar',
  initial: [],
  fetch: () => window.apiary.statusBarItems(),
  subscribe: (_push, invalidate) => window.apiary.onStatusBarChanged(invalidate),
})

export function useStatusBar(): StatusBarItem[] {
  return statusBarStore.useStore()
}

/** Runs when a plugin's data changed (a refresh landed): an open dashboard re-reads itself. */
export const onStatusBarChanged = (cb: () => void): (() => void) => statusBarStore.onInvalidate(cb)

/** The dashboard behind an item; null when the plugin has none. The bar says why it did not open. */
export const statusBarPanel = (pluginId: string, itemId: string): Promise<StatusBarPanel | null> =>
  window.apiary.statusBarPanel(pluginId, itemId)

/** Asks a plugin to refresh now; its answer arrives as a status-bar change, a failure is shown. */
export function refreshStatusBarItem(pluginId: string): void {
  surface(window.apiary.statusBarRefresh(pluginId), 'Could not refresh the status bar')
}

/** The user's answer to a plugin's consent prompt. Declining switches the plugin off in main; either
 *  way the bar re-reads through `statusBarChanged`. A failure is shown: the question would come back. */
export function answerStatusBarConsent(pluginId: string, allow: boolean): void {
  surface(window.apiary.statusBarConsent(pluginId, allow), 'Could not save your answer')
}
