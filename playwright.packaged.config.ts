import { defineConfig } from '@playwright/test'

/**
 * The opt-in packaged-app smoke (`npm run test:packaged`, TEST-7).
 *
 * Its own config and `testDir` (tests/packaged, outside the main config's tests/e2e) so a bare
 * `playwright test` never picks it up: it needs `electron-builder --dir` output in `release/`
 * first, which the script builds. One worker — it launches a single real packaged binary.
 */
export default defineConfig({
  testDir: './tests/packaged',
  timeout: 90000,
  expect: { timeout: 20000 },
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
})
