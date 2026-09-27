import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { resolve } from 'node:path'
import { mouse, emulateMedia } from './tests/component/commands'

/**
 * Component tests: the renderer in real Chromium (Vitest browser mode, Playwright provider)
 * against a fake `window.apiary` — see tests/component/renderApp.tsx. Separate from
 * vitest.config.ts because those run in Node against main-process code; these mount the renderer
 * in a browser environment and need neither Node's modules nor Electron.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    include: ['tests/component/**/*.test.tsx'],
    setupFiles: ['tests/component/setup.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage/component',
      include: ['src/renderer/**', 'src/shared/**'],
      reporter: ['text-summary', 'json-summary', 'html'],
    },
    // An assertion on an element not there yet fails its first attempt by printing the whole page
    // (the locator error embeds the DOM, formatted at unlimited depth) — which for the full app
    // overflowed the stack and took over a second, the entire default timeout, so the retry that
    // would have found the element never ran. No DOM dump, and a timeout with room for retries.
    env: { DEBUG_PRINT_LIMIT: '0' },
    expect: { poll: { timeout: 5000 } },
    browser: {
      enabled: true,
      // Vitest 4+ moved the browser provider out into its own package; `instances` replaces the
      // old `name: 'chromium'`.
      provider: playwright({
        // The page around the test iframe, big enough that the iframe is drawn at its own size —
        // a scaled iframe would put the real mouse somewhere other than where the test measured.
        contextOptions: { viewport: { width: 1600, height: 1000 } },
      }),
      instances: [{ browser: 'chromium' }],
      headless: true,
      viewport: { width: 1400, height: 900 },
      screenshotFailures: false,
      commands: { mouse, emulateMedia },
    },
  },
})
