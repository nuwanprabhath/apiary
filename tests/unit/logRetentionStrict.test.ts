import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/nowhere' } }))

const { effectiveLogRetentionDays } = await import('../../src/main/log/configure')

describe('log retention in privacy mode', () => {
  it('keeps logs at most 7 days in strict mode', () => {
    expect(effectiveLogRetentionDays({ logRetentionDays: 30, gdprStrictMode: true })).toBe(7)
    expect(effectiveLogRetentionDays({ logRetentionDays: 3, gdprStrictMode: true })).toBe(3)
  })

  it('applies the setting as chosen otherwise', () => {
    expect(effectiveLogRetentionDays({ logRetentionDays: 30, gdprStrictMode: false })).toBe(30)
  })
})
