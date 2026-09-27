import { useSyncExternalStore } from 'react'
import type { ThemeState } from '@shared/api'
import { applyTheme } from './applyTheme'

/**
 * One subscription to main's theme broadcast, shared by every `useThemeState()` caller.
 *
 * Before this, `useThemeState` opened its own `onThemeChanged` subscription per call site and
 * called `applyTheme` from inside it — harmless with one caller, but App and the open Settings
 * dialog's ThemesSection both call it, so **every theme broadcast applied the theme twice** while
 * Settings was open (UI-22). `applyTheme` removes and resets every custom property and dispatches
 * `THEME_CHANGE_EVENT` each time, and every mounted `TerminalView` re-reads computed style off
 * that event — so the second, redundant apply was not a no-op, just wasted work on the hot path
 * (CLAUDE.md "Theme performance is measured, not guessed"). A module-level store with one real
 * subscription, applying the theme exactly once per broadcast, removes the duplication rather than
 * papering over it.
 */
type Listener = () => void

// Read lazily, not at module load: a test may import this module before its fake bridge is on
// `window.apiary` (the old per-hook version read it the same way, inside `useState(() => ...)`).
let state: ThemeState | null = null
const listeners = new Set<Listener>()
// The bridge this store is currently subscribed to, so a component test that replaces
// `window.apiary` between renders (`renderApp()` assigns a fresh fake per test — production never
// replaces it after preload sets it once) resubscribes to the new one instead of silently keeping
// the old fake's subscription forever.
let subscribedTo: typeof window.apiary | null = null

/** Starts (or restarts, onto a new bridge) the one real subscription. */
function ensureStarted(): void {
  if (window.apiary === subscribedTo) return
  subscribedTo = window.apiary
  state = window.apiary.initialTheme
  window.apiary.onThemeChanged((next) => {
    applyTheme(next.active)
    state = next
    for (const listener of listeners) listener()
  })
  // `initialTheme` is what was true when the window loaded (a synchronous preload read, applied
  // before the first paint). Anything that mounts later — the Themes screen, a second window — can
  // find the state has moved on since, so this catches it up once at start.
  const startedOn = window.apiary
  void window.apiary.themeState().then((now) => {
    if (window.apiary !== startedOn) return // superseded by a newer bridge already
    state = now
    for (const listener of listeners) listener()
  }).catch(() => {
    // Background catch-up read (UI-23): a failure here just leaves `state` at `initialTheme`,
    // which is still a valid theme to be showing, and the next real `onThemeChanged` broadcast
    // moves it on regardless of whether this one-off read ever landed.
  })
}

function subscribe(listener: Listener): () => void {
  ensureStarted()
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot(): ThemeState {
  // `useSyncExternalStore` calls this during render, which can happen before `subscribe` runs
  // (React calls `subscribe` from a passive effect, after the first commit) — so this also has to
  // be able to start the store, not just read it.
  ensureStarted()
  return state as ThemeState
}

/**
 * The theme state, kept current from main's broadcast, and applied to this window as it changes.
 *
 * Every caller shares the one subscription above, so mounting this in more than one place (App
 * and an open Settings dialog, say) never applies a broadcast more than once.
 */
export function useThemeState(): ThemeState {
  return useSyncExternalStore(subscribe, getSnapshot)
}
