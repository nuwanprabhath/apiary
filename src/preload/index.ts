import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type ApiaryApi, type ThemeState } from '@shared/api'
import { localApis } from './local'

function subscribe(channel: string, cb: (...args: unknown[]) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...args)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/**
 * The bridge, built from `shared/ipc/contract.ts` instead of one hand-written line per channel
 * (MAIN-11): a channel added to the contract appears here automatically, and one left out of the
 * contract cannot appear here at all — the two can no longer drift apart the way the three
 * hand-maintained copies (this file, `shared/api.ts`, `main/ipc.ts`) used to.
 *
 * `initialTheme` stays the one hand-written entry: it is read synchronously once, at import time,
 * so the window's first paint is already themed (see `ApiaryApi.initialTheme`'s doc comment) —
 * every other entry is a function the renderer calls or subscribes to later.
 */
const api: Record<string, unknown> = {
  // Synchronous on purpose, and once: an async answer would arrive after React had painted the
  // original look.
  initialTheme: ipcRenderer.sendSync(IPC.themeInitial.channel) as ThemeState,
}

for (const [key, spec] of Object.entries(IPC)) {
  if (spec.kind === 'invoke') {
    api[key] = (...a: unknown[]) => ipcRenderer.invoke(spec.channel, ...a)
  } else if (spec.kind === 'send') {
    api[key] = (...a: unknown[]) => { ipcRenderer.send(spec.channel, ...a) }
  } else if (spec.kind === 'event') {
    api[`on${key[0].toUpperCase()}${key.slice(1)}`] = (cb: (...a: unknown[]) => void) =>
      subscribe(spec.channel, cb)
  } else if (spec.kind === 'local') {
    const impl = localApis[key as keyof typeof localApis] as (...args: unknown[]) => unknown
    const guard = spec.args
    api[key] = (...a: unknown[]) => {
      if (!guard(a)) throw new Error('Invalid request.')
      return impl(...a)
    }
  }
  // 'sync' (themeInitial) is handled once, above — every other kind of entry is covered.
}

// The cast is the one place this file is not statically checked against `ApiaryApi` — the loop
// above builds it from `IPC`'s keys, which TypeScript cannot follow value-by-value. What *is*
// checked: `tests/component/fakeApiary.ts` is typed as `ApiaryApi` (a channel this file forgot
// would be a type error there, not a silent gap), and every main-side handler is checked against
// the same contract by `main/ipc/registrar.ts`'s `Handlers`/`Listeners` types.
const typedApi: ApiaryApi = api as ApiaryApi
contextBridge.exposeInMainWorld('apiary', typedApi)
