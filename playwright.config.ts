import { defineConfig } from '@playwright/test'

/**
 * Two projects, so most of the suite runs in parallel and the few tests that cannot share the
 * machine do not have to.
 *
 * Every test launches its own app against its own fixture home and `--user-data-dir`, and the app
 * takes no single-instance lock, opens no fixed port and registers no global shortcut — so tests
 * are independent by construction. The exceptions are tagged `@serial`: the ones that use the OS
 * clipboard (one per machine), OS window focus, or measure the machine itself (typing under load,
 * a resize rate). They run one at a time, after the parallel project, on a quiet machine. Because
 * they depend on it, a failure in the parallel project skips them; run them on their own with
 * `npx playwright test --project=serial --no-deps`.
 *
 * `@smoke` marks a short run through the main paths (`npm run test:e2e:smoke`).
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: { timeout: 15000 },
  // A CI runner has fewer cores, and each worker is a whole Electron app.
  workers: process.env.CI ? 2 : 4,
  reporter: 'list',
  projects: [
    { name: 'parallel', grepInvert: /@serial/, fullyParallel: true },
    { name: 'serial', grep: /@serial/, workers: 1, dependencies: ['parallel'] },
  ],
})
