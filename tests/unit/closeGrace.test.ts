import { describe, it, expect } from 'vitest'
import { closeGraceMs } from '../../src/main/windows/closeGrace'
import { parseRuntimeEnv } from '../../src/main/app/env'

describe('closeGraceMs', () => {
  it('gives a minute where closing the last window quits, so windows closed by their X a few seconds apart all come back', () => {
    expect(closeGraceMs('linux')).toBe(60_000)
    expect(closeGraceMs('win32')).toBe(60_000)
  })

  it('stays short on a Mac, where closing a window is never a quit', () => {
    expect(closeGraceMs('darwin')).toBe(3000)
  })
})

describe('APIARY_CLOSE_GRACE_MS', () => {
  it('overrides the grace in tests, and only with a positive whole number', () => {
    expect(parseRuntimeEnv({ APIARY_CLOSE_GRACE_MS: '2000' }, [], false).closeGraceMs).toBe(2000)
    expect(parseRuntimeEnv({ APIARY_CLOSE_GRACE_MS: 'soon' }, [], false).closeGraceMs).toBeUndefined()
    expect(parseRuntimeEnv({ APIARY_CLOSE_GRACE_MS: '0' }, [], false).closeGraceMs).toBeUndefined()
    expect(parseRuntimeEnv({ APIARY_CLOSE_GRACE_MS: '2000' }, [], true).closeGraceMs).toBeUndefined()
  })
})
