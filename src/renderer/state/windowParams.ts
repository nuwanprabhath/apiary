import { isRemoteHost } from '@shared/domain/remote'
import { isWindowChrome, type WindowChrome } from '@shared/domain/windowChrome'
import { isTabTransfer, isWindowLayoutReport, type TabTransfer, type WindowLayoutReport } from '@shared/types'

/*
 * Everything here is read from the window's own URL (set at `createWindow`) rather than over IPC,
 * because it decides the layout from the first paint.
 */

export function windowNumber(): number {
  try {
    return Number(new URLSearchParams(window.location.search).get('w') ?? '1') || 1
  } catch {
    return 1
  }
}

/** The tab this window was torn off to show, or null. Over IPC the window would paint the full sidebar first. */
export function detachedKey(): string | null {
  try {
    const key = new URLSearchParams(window.location.search).get('detach')
    return key === null || key === '' ? null : key
  } catch {
    return null
  }
}

/** Null for an ordinary window, or when the URL carries something that is not a `TabTransfer`. */
export function detachedTransfer(): TabTransfer | null {
  try {
    const raw = new URLSearchParams(window.location.search).get('transfer')
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    return isTabTransfer(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * The previous run's record for this window, or null for an ordinary launch. Main has already
 * validated it and stripped `bounds` and `hasLayout`. A detached window is never a restored one.
 */
export function restoredWindow(): WindowLayoutReport | null {
  try {
    if (detachedKey() !== null) return null
    const raw = new URLSearchParams(window.location.search).get('restore')
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    return isWindowLayoutReport(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** A window opened without it (a test harness mounting the renderer directly) draws no title bar of its own. */
export function windowChrome(): WindowChrome {
  try {
    const value = new URLSearchParams(window.location.search).get('chrome')
    return isWindowChrome(value) ? value : 'system'
  } catch {
    return 'system'
  }
}

/** The work machine this window shows (`remote=<host>`), or null; anything that is not a host reads as null. */
export function remoteHost(): string | null {
  try {
    const host = new URLSearchParams(window.location.search).get('remote')
    return host !== null && isRemoteHost(host) ? host : null
  } catch {
    return null
  }
}
