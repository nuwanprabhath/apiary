import { BrowserWindow, ipcMain } from 'electron'
import { CHANNELS, type ThemeOptions, type ThemeState, type ThemeGenerateResult } from '@shared/api'
import { BUILTIN_THEMES } from '@shared/theme/builtins'
import { log } from '../log/logger'
import type { ThemeStore } from './themeStore'
import type { ThemeGenerator, ThemeModel } from './themeGenerator'
import { validateTheme, describeReport } from '@shared/theme/validate'

/**
 * The theme calls, and the one broadcast that keeps every window in the same theme.
 *
 * Nothing the renderer sends is trusted: a spec to save is validated by the store, an id must name
 * a theme that exists, and options are clamped there too.
 */
export function registerThemeIpc(store: ThemeStore, safeMode: boolean, generator: ThemeGenerator): { reset: (route: string) => void } {
  const state = (): ThemeState => ({
    activeId: store.activeId,
    active: safeMode ? null : store.activeSpec(),
    saved: store.saved,
    builtins: BUILTIN_THEMES.map((b) => ({ id: b.id, spec: b.spec })),
    options: store.options,
    safeMode,
  })
  const broadcast = (): void => {
    const s = state()
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(CHANNELS.themeChanged, s)
    }
  }

  ipcMain.on(CHANNELS.themeInitial, (e) => { e.returnValue = state() })
  ipcMain.handle(CHANNELS.themeState, () => state())
  ipcMain.handle(CHANNELS.themeApply, (_e, id: unknown) => {
    store.setActive(typeof id === 'string' ? id : null)
    // Which theme, not its contents: a saved theme's id is enough to tell apart what happened.
    log.info('theme', 'applied', { id: typeof id === 'string' ? (id.startsWith('builtin:') ? id : 'saved') : 'original' })
    broadcast()
  })
  ipcMain.handle(CHANNELS.themeSave, (_e, name: unknown, spec: unknown, prompt: unknown) => {
    const saved = store.add(typeof name === 'string' ? name : 'Untitled theme', spec, typeof prompt === 'string' ? prompt : null)
    broadcast()
    return saved
  })
  ipcMain.handle(CHANNELS.themeRename, (_e, id: unknown, name: unknown) => {
    if (typeof id !== 'string' || typeof name !== 'string') throw new Error('Not a theme.')
    store.rename(id, name)
    broadcast()
  })
  ipcMain.handle(CHANNELS.themeDelete, (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Not a theme.')
    store.remove(id)
    broadcast()
  })
  ipcMain.handle(CHANNELS.themeSetOptions, (_e, options: unknown) => {
    store.setOptions((typeof options === 'object' && options !== null ? options : {}) as Partial<ThemeOptions>)
    broadcast()
  })

  ipcMain.handle(CHANNELS.themeGenerate, async (_e, request: unknown, current: unknown): Promise<ThemeGenerateResult> => {
    if (typeof request !== 'string') throw new Error('Describe the theme you would like.')
    // The current theme, for a refinement, is re-validated too: it came from the renderer.
    const base = current === null || current === undefined ? null : validateTheme(current).spec
    const { spec, report } = await generator.generate({ request, current: base, model: store.options.model as ThemeModel })
    return { spec, note: describeReport(report) }
  })
  ipcMain.on(CHANNELS.themeGenerateCancel, () => { generator.cancel() })

  return {
    /** Back to the original look, from somewhere no theme can reach (the application menu). */
    reset: (route: string) => {
      store.setActive(null)
      log.info('theme', 'reset', { route })
      broadcast()
    },
  }
}
