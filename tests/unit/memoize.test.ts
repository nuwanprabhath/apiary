import { describe, it, expect } from 'vitest'
import { memoize } from '../../src/main/util/memoize'

describe('memoize (MAIN-10)', () => {
  it('calls the wrapped function once per distinct argument', () => {
    let calls = 0
    const check = memoize((path: string) => {
      calls += 1
      return path === '/exists'
    })
    expect(check('/exists')).toBe(true)
    expect(check('/exists')).toBe(true)
    expect(check('/exists')).toBe(true)
    expect(calls).toBe(1)
  })

  it('calls the wrapped function again for a different argument', () => {
    let calls = 0
    const check = memoize((path: string) => {
      calls += 1
      return path.length
    })
    check('/a')
    check('/bb')
    check('/a')
    expect(calls).toBe(2)
  })

  it('caches a false/falsy result too, not just truthy ones', () => {
    let calls = 0
    const check = memoize((_path: string) => {
      calls += 1
      return false
    })
    expect(check('/gone')).toBe(false)
    expect(check('/gone')).toBe(false)
    expect(calls).toBe(1)
  })
})
