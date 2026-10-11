import type { ActiveTabPayload } from '@shared/api'
import { createIpcStore } from './createIpcStore'
import { onRemoteReconnected } from './remote'

/**
 * Field-by-field equality on the payload's own fields (UI-4): main coalesces `activeTabsChanged`
 * to twice a second while any pty is printing, so without this every tick handed out a fresh array
 * — even when nothing in it actually changed — and every consumer (App, and anything reading
 * activity status) re-rendered on the same schedule. `windowNumber`/`key` identify the tab;
 * `view`/`status`/`label` are the only fields that can change under it.
 */
export function tabsEqual(a: ActiveTabPayload[], b: ActiveTabPayload[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (
      x.windowNumber !== y.windowNumber || x.key !== y.key || x.view !== y.view
      || x.status !== y.status || x.label !== y.label
    ) return false
  }
  return true
}

/**
 * Every open tab across every window, with its derived activity status, kept live.
 *
 * `onActiveTabsChanged` carries no payload — it says "ask again" — so each signal starts a fetch,
 * and overlapping ones resolve latest-request-wins: a slow answer to an earlier signal never lands
 * on top of a newer one. A transient failure leaves the list showing what it last knew (and is
 * logged); the signal fires again within a second or two whenever anything is running.
 */
const activeTabsStore = createIpcStore<ActiveTabPayload[]>({
  scope: 'tabs',
  initial: [],
  // Keep the previous array (and its identity) when nothing in it actually changed, so a memoised
  // consumer downstream does not re-render on every coalesced broadcast.
  equal: tabsEqual,
  fetch: () => window.apiary.activeTabs(),
  subscribe: (_push, invalidate) => {
    const off = [window.apiary.onActiveTabsChanged(invalidate), onRemoteReconnected(invalidate)]
    return () => { for (const f of off) f() }
  },
})

export function useActiveTabs(): ActiveTabPayload[] {
  return activeTabsStore.useStore()
}

/** Every open tab right now: joins a fetch already under way for the same signal, so a store woken
 *  by `activeTabsChanged` alongside this one reads the tabs that signal is about. */
export const currentActiveTabs = (): Promise<ActiveTabPayload[]> => activeTabsStore.current()
