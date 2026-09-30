import { isWindowChrome, type WindowChrome } from '@shared/domain/windowChrome'
import { isTabTransfer, isWindowLayoutReport, type TabTransfer, type WindowLayoutReport } from '@shared/types'

/**
 * Everything a window reads out of its own URL (set by main/index.ts at `createWindow`) — pulled
 * out of `uiState.ts`, which held this URL parsing alongside the `UiState` model itself even
 * though the two are unrelated: one is per-window identity read once at start-up, the other is
 * the mutable blob that model describes. App.tsx duplicated the `w` parsing a second time (its own
 * `windowNumber`) rather than reaching in here, which this also fixes.
 */

/** This window's own number — window 1 is the default when the URL carries none, since it is the
 *  one window type that predates every window having a number of its own. */
export function windowNumber(): number {
  try {
    return Number(new URLSearchParams(window.location.search).get('w') ?? '1') || 1
  } catch {
    return 1
  }
}

/**
 * The tab this window was torn off to show, or null for an ordinary window.
 *
 * Read from the URL for the same reason the window number is: it decides the whole layout, and a
 * window that asked over IPC would paint the full sidebar first and rearrange itself a moment
 * later.
 */
export function detachedKey(): string | null {
  try {
    const key = new URLSearchParams(window.location.search).get('detach')
    return key === null || key === '' ? null : key
  } catch {
    return null
  }
}

/**
 * Everything else about the tab this window was torn off to show — see TabTransfer. Null when the
 * window is an ordinary one, or when the URL carries something that is not a tab.
 */
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
 * The previous run's record for this window, or null for an ordinary launch. Read from the URL
 * for the same reason `detachedTransfer` is: the layout it decides is needed at first render, and
 * main has already validated and stripped `bounds` (and `hasLayout`, a main-only pruning signal)
 * out of it before putting it here (see `createWindow` in main/index.ts). Detached windows never
 * carry `?restore=`, but a window with both would be a bug worth not acting on, so a detached
 * window is never treated as a restored one even if it somehow did.
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

/**
 * How this window's title bar is drawn (see `WindowChrome`). Read from the URL, like the window
 * number, because it decides the layout from the first paint. A window opened without it — a
 * test harness mounting the renderer directly — draws none of its own.
 */
export function windowChrome(): WindowChrome {
  try {
    const value = new URLSearchParams(window.location.search).get('chrome')
    return isWindowChrome(value) ? value : 'system'
  } catch {
    return 'system'
  }
}
