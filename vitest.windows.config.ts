import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// The window placement suite (tests/windows). Opt-in: `npm run test:windows`. It builds
// an image, so the timeouts are minutes, not seconds.
export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/windows/**/*.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 3_600_000,
    fileParallelism: false,
  },
})
