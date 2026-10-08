import { app, ipcMain } from 'electron'
import { CHANNELS, IPC } from '@shared/api'
import type { ThemeState, ThemeGenerateResult } from '@shared/theme/state'
import { BUILTIN_THEMES, BUILTIN_THEME_PREFIX } from '@shared/theme/builtins'
import { validateTheme, describeReport } from '@shared/theme/validate'
import { log } from '../../log/logger'
import type { ThemeStore } from '../../theme/themeStore'
import type { ThemeGenerator } from '../../theme/themeGenerator'
import { broadcast } from '../../windows/broadcast'
import type { Handlers, Listeners } from '../registrar'

export interface ThemeDeps {
  store: ThemeStore
  safeMode: boolean
  generator: ThemeGenerator
}

type HandledKeys =
  | 'themeState' | 'themeGpuCompositing' | 'themeApply' | 'themeSave' | 'themeRename' | 'themeDelete'
  | 'themeSetOptions' | 'themeGenerate'
type ListenedKeys = 'themeGenerateCancel'

/**
 * The theme calls, and the one broadcast that keeps every window in the same theme. Registered
 * through the same `registerAll` wrapper as everything else (MAIN-19 item 4) — before this,
 * `themeIpc.ts` called `ipcMain.handle`/`.on` directly, so a rejecting theme handler skipped the
 * logging and sender check every other channel got.
 *
 * `themeInitial` is the one exception, registered here rather than through `registerAll`: it is a
 * `sendSync` (`ApiaryApi.initialTheme`'s doc comment explains why), and the registrar only wires
 * up `invoke`/`send` channels.
 *
 * Nothing the renderer sends is trusted: a spec to save is validated by the store, an id must name
 * a theme that exists, and options are clamped there too.
 */
export function themeHandlers(deps: ThemeDeps): {
  handlers: Pick<Handlers, HandledKeys>
  listeners: Pick<Listeners, ListenedKeys>
  /** Back to the original look, from somewhere no theme can reach (the application menu). */
  reset: (route: string) => void
  dispose: () => void
} {
  const { store, safeMode, generator } = deps

  const state = (): ThemeState => ({
    activeId: store.activeId,
    active: safeMode ? null : store.activeSpec(),
    saved: store.saved,
    builtins: BUILTIN_THEMES.map((b) => ({ id: b.id, spec: b.spec })),
    options: store.options,
    safeMode,
  })
  const broadcastTheme = (): void => { broadcast(IPC.themeChanged, state()) }

  const onThemeInitial = (e: { returnValue: unknown }): void => { e.returnValue = state() }
  ipcMain.on(CHANNELS.themeInitial, onThemeInitial)

  // Asked by each window once it is up — by then the GPU process has reported what it can do.
  // Logged the first time: "the theme is slow here" starts with whether the GPU is in use at all,
  // which on Linux Chromium decides for itself (driver, Wayland/X11, blocklist).
  let gpuLogged = false

  return {
    handlers: {
      themeState: () => state(),
      themeGpuCompositing: () => {
        const status = app.getGPUFeatureStatus()
        if (!gpuLogged) {
          gpuLogged = true
          log.info('theme', 'gpu', { compositing: status.gpu_compositing, rasterization: status.rasterization, webgl: status.webgl })
        }
        return String(status.gpu_compositing).startsWith('enabled')
      },
      themeApply: (_e, id) => {
        store.setActive(id)
        // Which theme, not its contents: a saved theme's id is enough to tell apart what happened.
        log.info('theme', 'applied', { id: id !== null ? (id.startsWith(BUILTIN_THEME_PREFIX) ? id : 'saved') : 'original' })
        broadcastTheme()
      },
      themeSave: (_e, name, spec, prompt) => {
        const saved = store.add(name, spec, prompt ?? null)
        broadcastTheme()
        return saved
      },
      themeRename: (_e, id, name) => {
        store.rename(id, name)
        broadcastTheme()
      },
      themeDelete: (_e, id) => {
        store.remove(id)
        broadcastTheme()
      },
      themeSetOptions: (_e, options) => {
        store.setOptions(options)
        broadcastTheme()
      },
      themeGenerate: async (_e, request, current): Promise<ThemeGenerateResult> => {
        // The current theme, for a refinement, is re-validated too: it came from the renderer.
        const base = current === null ? null : validateTheme(current).spec
        const { spec, report } = await generator.generate({ request, current: base, model: store.options.model })
        return { spec, note: describeReport(report) }
      },
    },
    listeners: {
      themeGenerateCancel: () => { generator.cancel() },
    },
    reset: (route: string) => {
      store.setActive(null)
      log.info('theme', 'reset', { route })
      broadcastTheme()
    },
    dispose: () => { ipcMain.off(CHANNELS.themeInitial, onThemeInitial) },
  }
}
