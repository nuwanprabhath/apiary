import { themeToCssVars, ALL_THEME_VARS } from '@shared/theme/cssVars'
import type { ThemeSpec } from '@shared/theme/spec'

/** Fired on `window` after a theme is applied, for the parts that paint from JS (the terminals). */
export const THEME_CHANGE_EVENT = 'apiary:themechange'

/**
 * Puts a validated theme on the page, or takes it off again (`null`, the original look).
 *
 * The whole mechanism is `style.setProperty` for allowlisted custom properties plus two
 * attributes that pick a font stack defined in styles.css. No stylesheet is injected and nothing
 * the theme wrote is parsed as CSS; the values were formatted by Apiary (see cssVars.ts).
 */
export function applyTheme(spec: ThemeSpec | null): void {
  const root = document.documentElement
  for (const name of ALL_THEME_VARS) root.style.removeProperty(name)
  if (spec === null) {
    delete root.dataset.uiFont
    delete root.dataset.monoFont
    delete root.dataset.material
    delete root.dataset.refraction
  } else {
    for (const [name, value] of Object.entries(themeToCssVars(spec))) root.style.setProperty(name, value)
    root.dataset.uiFont = spec.font.ui
    root.dataset.monoFont = spec.font.mono
    root.dataset.material = spec.material.kind
    // The lens filter itself is rendered by GlassLens with the strength in it; this only says
    // whether the panels should use it.
    if (spec.material.kind === 'glass' && spec.material.refraction > 0) root.dataset.refraction = ''
    else delete root.dataset.refraction
  }
  window.dispatchEvent(new CustomEvent<ThemeSpec | null>(THEME_CHANGE_EVENT, { detail: spec }))
}
