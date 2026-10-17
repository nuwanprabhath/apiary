import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// `npm run screenshot:remote`: the README's remote-access picture. It reuses the Docker test bed
// (tests/remote), so it runs under Vitest like that suite, with the same minutes-long timeouts.
export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    globals: true,
    environment: 'node',
    include: ['scripts/screenshot/remote.shot.ts'],
    testTimeout: 600_000,
    hookTimeout: 1_800_000,
    fileParallelism: false,
  },
})
