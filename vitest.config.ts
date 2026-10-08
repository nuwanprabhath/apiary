import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage/node',
      include: ['src/main/**/*.ts', 'src/shared/**/*.ts', 'src/renderer/state/**/*.ts'],
      exclude: ['src/main/index.ts', 'src/main/app/menu.ts'],
      reporter: ['text-summary', 'json-summary', 'html', 'lcov'],
      // A ratchet, not a target: each is one point under the 1.33.0 measurement, so a change that
      // drops coverage fails `npm run test:coverage` in CI. Raise them when the numbers rise; never lower.
      thresholds: { lines: 85, statements: 82, functions: 77, branches: 79 },
    },
    // unit = pure logic, filesystem-only or fully-mocked; integration = drives a real git or pty
    // subprocess, or loads a native module (better-sqlite3, node-pty). See tests/unit/purity.test.ts
    // for the guard that keeps that split honest.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          fileParallelism: true,
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          setupFiles: ['tests/integration/setup.ts'],
          include: ['tests/integration/**/*.test.ts'],
          // Several files (worktreeResolver, ptyManager, branchOps, appService) drive real git and
          // pty subprocesses rather than mocking them out. Run concurrently, those workers contend
          // for the same machine and a test awaiting real git work can overrun its timeout —
          // measured at roughly half of runs once the suite grew past 40-odd files. Serial
          // execution costs about 13 seconds (21.6s vs 8.7s); that is a fair price for a suite
          // whose green means something.
          fileParallelism: false,
        },
      },
    ],
  },
})
