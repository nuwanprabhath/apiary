import { useSyncExternalStore } from 'react'
import type { ThemeState } from '@shared/api'
import { applyTheme } from '../theme/applyTheme'
import { background } from './policy'
import { keyedListeners, rebindOnNewBridge } from './bridgeBinding'

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
const listeners = keyedListeners<Listener>()
const EVERYONE = ''
const notify = (): void => { for (const listener of listeners.of(EVERYONE)) listener() }

/** Starts (or restarts, onto a new bridge: a component test's fresh fake) the one real subscription. */
const ensureStarted = rebindOnNewBridge((api) => {
  state = api.initialTheme
  const unsubscribe = api.onThemeChanged((next) => {
    applyTheme(next.active)
    state = next
    notify()
  })
  // `initialTheme` is what was true when the window loaded (a synchronous preload read, applied
  // before the first paint). Anything that mounts later — the Themes screen, a second window — can
  // find the state has moved on since, so this catches it up once at start.
  // A failure here (logged) leaves `state` at `initialTheme`, which is still a valid theme to be
  // showing, and the next real `onThemeChanged` broadcast moves it on regardless.
  background(api.themeState().then((now) => {
    if (window.apiary !== api) return // superseded by a newer bridge already
    state = now
    notify()
  }), 'theme')
  return unsubscribe
})

/** `useSyncExternalStore`'s subscribe: a module-level function, so React does not resubscribe each render. */
function onThemeState(listener: Listener): () => void {
  ensureStarted()
  return listeners.add(EVERYONE, listener)
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
  return useSyncExternalStore(onThemeState, getSnapshot)
}
