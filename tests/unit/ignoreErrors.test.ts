import { describe, it, expect } from 'vitest'
import { ignoreErrors, ignoreErrorsAsync } from '@shared/ignoreErrors'

describe('ignoreErrors', () => {
  it('returns the value when the call succeeds', () => {
    expect(ignoreErrors(() => 7, 'never fails')).toBe(7)
  })

  it('returns undefined instead of throwing', () => {
    expect(ignoreErrors(() => { throw new Error('gone') }, 'the process can exit first')).toBeUndefined()
  })

  it('swallows a non-Error throw too', () => {
    expect(ignoreErrors(() => JSON.parse('{ truncated') as unknown, 'a truncated line')).toBeUndefined()
  })
})

describe('ignoreErrorsAsync', () => {
  it('resolves to the value when the call succeeds', async () => {
    await expect(ignoreErrorsAsync(() => Promise.resolve('ok'), 'never fails')).resolves.toBe('ok')
  })

  it('resolves to undefined when the call rejects', async () => {
    await expect(ignoreErrorsAsync(() => Promise.reject(new Error('gone')), 'the file may be gone')).resolves.toBeUndefined()
  })

  it('resolves to undefined when the call throws before returning a promise', async () => {
    await expect(ignoreErrorsAsync(() => { throw new Error('sync') }, 'whichever way it fails')).resolves.toBeUndefined()
  })
})
