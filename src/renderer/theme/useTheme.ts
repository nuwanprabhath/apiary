import { useEffect, useState } from 'react'
import type { ThemeState } from '@shared/api'
import { applyTheme, THEME_CHANGE_EVENT } from './applyTheme'
import type { ThemeSpec } from '@shared/theme/spec'

/**
 * The theme state, kept current from main's broadcast, and applied to this window as it changes.
 *
 * Starts from `initialTheme` — the synchronous read the preload made — which main.tsx has already
 * applied before the first render, so a themed window never flashes the original look.
 */
export function useThemeState(): ThemeState {
  const [state, setState] = useState<ThemeState>(() => window.apiary.initialTheme)
  useEffect(() => {
    let live = true
    const off = window.apiary.onThemeChanged((next) => {
      applyTheme(next.active)
      setState(next)
    })
    // `initialTheme` is what was true when the window loaded. Anything mounted later (the Themes
    // screen) would otherwise show that, not what is applied now.
    void window.apiary.themeState().then((now) => { if (live) setState(now) })
    return () => { live = false; off() }
  }, [])
  return state
}

/**
 * Whatever this window is showing right now — the active theme, or a preview the Themes screen
 * put up. The effects layer follows this rather than the saved choice, so a preview shows its
 * effects too.
 */
export function useAppliedTheme(): ThemeSpec | null {
  const [spec, setSpec] = useState<ThemeSpec | null>(() => window.apiary.initialTheme.active)
  useEffect(() => {
    const on = (e: Event): void => { setSpec((e as CustomEvent<ThemeSpec | null>).detail) }
    window.addEventListener(THEME_CHANGE_EVENT, on)
    return () => { window.removeEventListener(THEME_CHANGE_EVENT, on) }
  }, [])
  return spec
}
