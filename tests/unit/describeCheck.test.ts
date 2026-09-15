import { describe, it, expect } from 'vitest'
import type { UpdateStatusPayload } from '@shared/api'
import { describeCheck } from '../../src/renderer/state/updateSummary'

const status = (over: Partial<UpdateStatusPayload>): UpdateStatusPayload => ({
  phase: 'idle',
  capability: { kind: 'assisted', reason: 'Unsigned build.' },
  currentVersion: '1.12.0',
  availableVersion: null,
  releaseNotes: null,
  releaseUrl: null,
  progressPercent: null,
  install: null,
  downloadedPath: null,
  error: null,
  lastCheckedAt: null,
  skippedVersion: null,
  ...over,
})

describe('describeCheck', () => {
  it('says the app is up to date when the check found nothing newer', () => {
    expect(describeCheck(status({ phase: 'up-to-date' })))
      .toBe('Apiary 1.12.0 is the latest version.')
  })

  it('names the version that is available', () => {
    expect(describeCheck(status({ phase: 'available', availableVersion: '1.13.0' })))
      .toBe('Apiary 1.13.0 is available.')
  })

  it('gives the reason a check could not run at all, rather than staying silent', () => {
    // The case that made this function necessary: a build with no updater answers every check
    // with this status and pushes nothing, so the button appeared to do nothing when pressed.
    expect(describeCheck(status({
      phase: 'error',
      capability: { kind: 'unsupported', reason: 'Running from source — updates apply to installed builds only.' },
    }))).toBe('Running from source — updates apply to installed builds only.')
  })

  it('reports a failed check with what went wrong', () => {
    expect(describeCheck(status({ phase: 'error', error: 'getaddrinfo ENOTFOUND github.com' })))
      .toBe('Could not check — getaddrinfo ENOTFOUND github.com')
  })
})
