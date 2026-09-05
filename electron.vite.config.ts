import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
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
