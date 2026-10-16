import { useSyncExternalStore } from 'react'
import type { ThemeState } from '@shared/api'
import { applyTheme } from '../theme/applyTheme'
import { background } from './policy'
import { keyedListeners, rebindOnNewBridge } from './bridgeBinding'

/**
 * One subscription to main's theme broadcast, shared by every `useThemeState()` caller.
 *
 * App and the open Settings dialog's ThemesSection both call it, so a subscription per caller
 * would apply the theme twice per broadcast. `applyTheme` resets every custom property and
 * dispatches `THEME_CHANGE_EVENT`, and every mounted `TerminalView` re-reads computed style off
 * that event, so the second apply is not a no-op.
 */
type Listener = () => void

// Read lazily, not at module load: a test may import this module before its fake bridge is on
// `window.apiary`.
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
  // `initialTheme` is what was true when the window loaded; the state may have moved on since.
  // A failed fetch leaves `initialTheme`, still a valid theme, until the next broadcast.
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

/** The theme state, kept current from main's broadcast and applied to this window as it changes. */
export function useThemeState(): ThemeState {
  return useSyncExternalStore(onThemeState, getSnapshot)
}
