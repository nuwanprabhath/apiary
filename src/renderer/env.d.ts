import type { ApiaryApi } from '@shared/api'

/**
 * The renderer's one way into the main process: `window.apiary`, set by the preload's
 * `contextBridge.exposeInMainWorld`. Declared here, not in `shared/api.ts`, because `Window` is a
 * DOM global — `tsconfig.node.json` has no DOM lib, so a shared file augmenting it would fail
 * main's typecheck the moment shared purity is enforced (SHARED-5).
 */
declare global {
  interface Window { apiary: ApiaryApi }
}
