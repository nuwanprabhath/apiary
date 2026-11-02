import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// A resident on the real `claude` (tests/resident-live). Opt-in: `npm run test:resident-live`, which
// sets APIARY_LIVE_CLAUDE=1. It spends real tokens and waits on a real background task.
export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/resident-live/**/*.test.ts'],
    testTimeout: 300_000,
    fileParallelism: false,
  },
})
