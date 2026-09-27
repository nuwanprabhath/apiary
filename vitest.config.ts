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
      include: ['src/main/**', 'src/shared/**', 'src/renderer/state/**'],
      exclude: ['src/main/index.ts', 'src/main/app/menu.ts'],
      reporter: ['text-summary', 'json-summary', 'html', 'lcov'],
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
