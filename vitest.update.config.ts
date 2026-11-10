import './tests/fixtures/outerGitEnv'
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// The Ubuntu Install and restart suite (tests/update). Opt-in: `npm run test:update-deb`. It builds
// an image with two .debs, so the timeouts are minutes, not seconds.
export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/update/**/*.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 3_600_000,
    fileParallelism: false,
  },
})
