import { useEffect, useState } from 'react'
import { THEME_CHANGE_EVENT } from './applyTheme'
import type { ThemeSpec } from '@shared/theme/spec'
import { initialTheme } from '../state/theme'

export { useThemeState } from '../state/themeStore'

/**
 * Whatever this window is showing right now — the active theme, or a preview the Themes screen
 * put up. The effects layer follows this rather than the saved choice, so a preview shows its
 * effects too.
 */
export function useAppliedTheme(): ThemeSpec | null {
  const [spec, setSpec] = useState<ThemeSpec | null>(() => initialTheme().active)
  useEffect(() => {
    const on = (e: Event): void => { setSpec((e as CustomEvent<ThemeSpec | null>).detail) }
    window.addEventListener(THEME_CHANGE_EVENT, on)
    return () => { window.removeEventListener(THEME_CHANGE_EVENT, on) }
  }, [])
  return spec
}
