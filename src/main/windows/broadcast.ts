import { BrowserWindow } from 'electron'
import type { EventSpec } from '@shared/ipc/contract'
import { scopeOfChannel, type ChannelScope } from '../remote/scopes'
import { sendEvent, type EventTarget } from './sendEvent'

/** A source of extra windows `broadcast` reaches; each entry is a window that is not an Electron one. */
export type BroadcastTargets = () => Iterable<EventTarget & { isDestroyed(): boolean }>

const extraTargets = new Set<BroadcastTargets>()

/**
 * Adds windows `broadcast` reaches beyond Electron's: the remote server's virtual windows
 * (`remote/virtualContents.ts`). They receive only events whose scope is `remote` (the work
 * machine's own data); the home look, pets and settings are not theirs. Returns a disposer.
 */
export function registerBroadcastTargets(source: BroadcastTargets): () => void {
  extraTargets.add(source)
  return () => { extraTargets.delete(source) }
}

/** Whether `broadcast` leaves window `webContentsId` out of an event whose channel has this scope. */
export type BroadcastSkip = (webContentsId: number, scope: ChannelScope) => boolean

const skips = new Set<BroadcastSkip>()

/**
 * The one hook for windows that must not hear some of home's own events: a window showing a work
 * machine (`remote/remoteWindows.ts`) is skipped for `remote`-scope events, because home's
 * `treeChanged`, `ptyData` and `chatChanged` describe home's sessions, not the work machine's. Its
 * `local` events (`themeChanged`, `toggleSidebar`) still arrive. Returns a disposer.
 */
export function registerBroadcastSkip(skip: BroadcastSkip): () => void {
  skips.add(skip)
  return () => { skips.delete(skip) }
}

function skipped(webContentsId: number, scope: ChannelScope): boolean {
  for (const skip of skips) if (skip(webContentsId, scope)) return true
  return false
}

/**
 * Sends `event` to every open window, not just the focused one.
 *
 * With more than one window open, terminal output, tree changes and other state updates belong to
 * whichever windows are showing them — which is not necessarily the one in front, and can be
 * several at once. Sending to a single window leaves a background window's terminal or sidebar
 * stale until it is clicked (MAIN-12). Destroyed windows are skipped rather than filtered ahead of
 * time: one can close between this list being taken and the send landing.
 *
 * `event` is a contract entry (`IPC.petsChanged`), not a channel string, so the payload is checked
 * against the type the renderer's `onPetsChanged` hands its callback — a payload of the wrong shape,
 * or a missing one, is a compile error on the sending side too.
 */
export function broadcast<P extends unknown[]>(event: EventSpec<P>, ...payload: P): void {
  const scope = scopeOfChannel(event.channel)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !skipped(win.webContents.id, scope)) sendEvent(win.webContents, event, ...payload)
  }
  if (extraTargets.size === 0 || scope !== 'remote') return
  for (const source of extraTargets) {
    for (const target of source()) if (!target.isDestroyed()) sendEvent(target, event, ...payload)
  }
}
