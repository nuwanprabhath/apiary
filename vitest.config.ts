import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    // Several integration files (worktreeResolver, ptyManager, branchOps, appService) drive real
    // git and pty subprocesses rather than mocking them out. Run concurrently, those workers
    // contend for the same machine and a test awaiting real git work can overrun its timeout —
    // measured at roughly half of runs once the suite grew past 40-odd files. Serial execution
    // costs about 13 seconds (21.6s vs 8.7s); that is a fair price for a suite whose green means
    // something.
    fileParallelism: false,
  },
})
