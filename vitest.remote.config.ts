import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// The Docker SSH suite (tests/remote). Opt-in: `npm run test:remote`. It builds an image, so the
// timeouts are minutes, not seconds.
export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/remote/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 1_800_000,
    fileParallelism: false,
  },
})
