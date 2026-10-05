import { defineConfig } from '@playwright/test'

/**
 * Config for the verify-apiary skill's drives (see SKILL.md). Drives are not tests: they live
 * outside `tests/e2e` so `npm run test:e2e` never runs them, and their output goes to `.verify/`
 * so Playwright's habit of wiping its outputDir never touches the suite's `test-results/`.
 */
export default defineConfig({
  testDir: './drives',
  testMatch: '**/*.verify.ts',
  globalSetup: '../../../tests/e2e/globalSetup.ts',
  outputDir: '../../../.verify/playwright',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: 'list',
})
