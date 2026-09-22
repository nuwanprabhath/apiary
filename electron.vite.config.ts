import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    // `@xterm/headless` is bundled rather than externalised. It is CommonJS, and the main bundle
    // is ESM: left external, `import { Terminal } from '@xterm/headless'` becomes a Node ESM
    // import of a CJS module, whose named exports Node cannot see — the app died at startup with
    // "Named export 'Terminal' not found". Bundling lets rollup do the interop, and has the side
    // benefit that nothing has to be present in node_modules at runtime for it.
    // `@xterm/addon-serialize` is bundled for the same reason: it is CommonJS as well.
    plugins: [externalizeDepsPlugin({ exclude: ['@xterm/headless', '@xterm/addon-serialize'] })],
    resolve: { alias: shared },
    build: {
      rollupOptions: {
        // The search worker is a second entry point, emitted beside the main bundle so
        // `SearchClient` can start it by path. It runs the FTS index on a thread of its own —
        // see searchWorker.ts for why that is not optional.
        input: {
          index: resolve('src/main/index.ts'),
          searchWorker: resolve('src/main/search/searchWorker.ts'),
        },
        output: { entryFileNames: '[name].js' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    // Preload scripts run with sandbox: true, which loads them as plain
    // (non-module) JavaScript regardless of package.json's "type": "module".
    // Force CJS output here so the bundle stays require()-based and Electron
    // can actually execute it; otherwise the bare `import` in an ESM .mjs
    // bundle throws and contextBridge.exposeInMainWorld never runs.
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.js' } } },
  },
  renderer: {
    root: 'src/renderer',
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
    resolve: { alias: shared },
    plugins: [react()],
  },
})
