import type { ThemeSpec } from '@shared/theme/spec'
import type { SavedTheme, ThemeGenerateResult, ThemeOptions } from '@shared/theme/state'
import type { ThemeState } from '@shared/theme/state'
import { bestEffort } from './policy'

/**
 * Commands on themes. The theme itself (the active one, applied before first paint and on every
 * broadcast) is `state/themeStore.ts`; this is what the Themes screen does with it. All of them
 * are awaited by that screen, which shows a failure under the control that caused it.
 */

/** What was true when the window loaded: a synchronous preload read, applied before first paint. */
export const initialTheme = (): ThemeState => window.apiary.initialTheme

/** Whether the GPU composites this window; the effects layer assumes yes until main answers. */
export const readGpuCompositing = (): Promise<boolean | null> => bestEffort(window.apiary.themeGpuCompositing(), 'theme')

export const generateTheme = (request: string, current: ThemeSpec | null): Promise<ThemeGenerateResult> =>
  window.apiary.themeGenerate(request, current)
export function cancelThemeGeneration(): void { window.apiary.themeGenerateCancel() }
export const saveTheme = (name: string, spec: unknown, prompt?: string): Promise<SavedTheme> =>
  window.apiary.themeSave(name, spec, prompt)
/** Applies a saved theme, or `null` for the default. */
export const activateTheme = (id: string | null): Promise<void> => window.apiary.themeApply(id)
export const renameTheme = (id: string, name: string): Promise<void> => window.apiary.themeRename(id, name)
export const deleteTheme = (id: string): Promise<void> => window.apiary.themeDelete(id)
export const setThemeOptions = (options: Partial<ThemeOptions>): Promise<void> => window.apiary.themeSetOptions(options)
