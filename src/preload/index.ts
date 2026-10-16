import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type ApiaryApi, type ThemeState } from '@shared/api'
import { localApis } from './local'

function subscribe(channel: string, cb: (...args: unknown[]) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...args)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/**
 * The bridge, built from `shared/ipc/contract.ts`: a channel added to the contract appears here
 * automatically. `initialTheme` is the one hand-written entry, read synchronously at import time
 * so the window's first paint is already themed.
 */
const api: Record<string, unknown> = {
  // Synchronous: an async answer would arrive after React had painted the original look.
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
}

// The cast is the one place this file is not checked against `ApiaryApi`: TypeScript cannot follow
// the loop value-by-value. `tests/component/fakeApiary.ts` is typed as `ApiaryApi`, and main-side
// handlers are checked against the same contract by `main/ipc/registrar.ts`.
const typedApi: ApiaryApi = api as ApiaryApi
contextBridge.exposeInMainWorld('apiary', typedApi)
