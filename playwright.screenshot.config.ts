import { defineConfig } from '@playwright/test'

/**
 * A separate, minimal config just for `npm run screenshot` (scripts/screenshot.spec.ts).
 *
 * It isn't a real test — it asserts nothing and only exists to produce docs/screenshot.png — so
 * it deliberately doesn't live under the main config's `testDir` (`tests/e2e`): keeping it out of
 * that directory is what stops `npm run test:e2e`'s bare `playwright test` from ever picking it
 * up as an 89th test to run and report on.
 */
export default defineConfig({
  testDir: './scripts',
  testMatch: 'screenshot.spec.ts',
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: 'list',
})
