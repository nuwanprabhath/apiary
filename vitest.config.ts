import './tests/fixtures/outerGitEnv'
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    globals: true,
    environment: 'node',
    // One temp root per run, removed at the end (tests/fixtures/tmpRoot.ts).
    globalSetup: ['tests/fixtures/tmpRoot.ts'],
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
          // These files drive real git and pty subprocesses. Every worker on every core made them
          // contend until a test awaiting real git overran its timeout (about half of runs, at 40-odd
          // files), so the suite ran one file at a time. That cost 13 s then and 290 s by 1.59
          // (294 s serial, 128 s on 4 workers, on an M-series Mac). Half the cores keeps the
          // contention down, and a poll waits up to 5 s, as in the component project: a chat
          // clause's first turn overran the 1 s default under load.
          fileParallelism: true,
          maxWorkers: '50%',
          // Its own group, after unit's: Vitest runs one group's projects with one worker count.
          sequence: { groupOrder: 1 },
          expect: { poll: { timeout: 5000 } },
        },
      },
    ],
  },
})
