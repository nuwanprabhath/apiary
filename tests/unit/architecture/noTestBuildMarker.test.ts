import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Prevents: a release that reads `APIARY_*` test hooks. A packaged build honours them only when its
 * package.json carries `"apiaryTestBuild": true` (`isTestBuild` in `src/main/app/env.ts`), which the
 * Ubuntu update e2e sets with `-c.extraMetadata.apiaryTestBuild=true`. Nothing a release is built
 * from may set it. A workflow may name the marker (the release checks the built .deb for it), but
 * never give it a value. `release.yml` also checks the built .deb and macOS zip.
 */
const ROOT = join(__dirname, '../../..')
const SETS_MARKER = /apiaryTestBuild["']?\s*[:=]/

function releaseInputs(): string[] {
  const workflows = readdirSync(join(ROOT, '.github/workflows')).map((f) => join('.github/workflows', f))
  return ['package.json', 'electron-builder.yml', ...workflows]
}

describe('no release input marks the build as a test build', () => {
  it.each(releaseInputs())('%s does not set apiaryTestBuild', (file) => {
    expect(SETS_MARKER.test(readFileSync(join(ROOT, file), 'utf8'))).toBe(false)
  })

  it('the pattern catches each way of setting it', () => {
    for (const text of ['"apiaryTestBuild": true', '-c.extraMetadata.apiaryTestBuild=true', 'apiaryTestBuild: true']) {
      expect(SETS_MARKER.test(text)).toBe(true)
    }
    expect(SETS_MARKER.test(`grep -qa '"apiaryTestBuild"' app.asar`)).toBe(false)
  })
})
