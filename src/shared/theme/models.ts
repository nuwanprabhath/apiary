/** Which Claude models the theme generator can be asked to use. Canonical here so the renderer's
 *  model picker cannot silently list a model the generator does not accept (MAIN-22 / SHARED-2) —
 *  before this, `ThemesSection.tsx` hardcoded the same three ids by hand. */
export const THEME_MODELS = ['sonnet', 'haiku', 'opus'] as const
export type ThemeModel = typeof THEME_MODELS[number]
