import { describe, it, expect } from 'vitest'
import { versionsToAnnotate, isTransientDownloadFailure, tagsWithoutRelease, missingAssets } from '../../scripts/release.mjs'

const CHANGELOG = `# Changelog

## [1.60.6] - 2026-11-10

## [1.60.5] - 2026-11-10 (not released; shipped in 1.60.x)

## [1.60.4] - 2026-11-10

## [1.60.0] - 2026-11-09

## [1.59.0] - 2026-11-01
`

describe('release script', () => {
  it('annotates an unannotated version that has no tag once a later one shipped', () => {
    expect(versionsToAnnotate(CHANGELOG, ['v1.60.0', 'v1.59.0', 'v1.60.6'])).toEqual([{ version: '1.60.4', shippedIn: '1.60.6' }])
  })

  it('leaves the newest unreleased version alone', () => {
    expect(versionsToAnnotate(CHANGELOG, ['v1.60.0', 'v1.59.0'])).toEqual([])
  })

  it('tells a transient download error from a real failure', () => {
    expect(isTransientDownloadFailure('Error: Response code 503 (Service Unavailable)')).toBe(true)
    expect(isTransientDownloadFailure('download failed: ETIMEDOUT')).toBe(true)
    expect(isTransientDownloadFailure('read ECONNRESET')).toBe(true)
    expect(isTransientDownloadFailure('FAIL tests/unit/x.test.ts')).toBe(false)
  })

  it('lists tags with no release and missing assets', () => {
    expect(tagsWithoutRelease(['v2', 'v1'], ['v1'])).toEqual(['v2'])
    expect(missingAssets(['a.dmg', 'a.zip', 'latest-mac.yml', 'a.AppImage', 'a.deb'])).toHaveLength(1)
  })
})
