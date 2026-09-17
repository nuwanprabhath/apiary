import { describe, it, expect } from 'vitest'
import { isTabTransfer } from '../../src/shared/types'

const valid = {
  key: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  view: 'terminal',
  ptyId: 'new:1234',
  shells: [{ id: '1', name: 'Terminal 1' }],
  activeShell: '1',
}

describe('a tab arriving from another window', () => {
  it('is accepted with everything it needs to pick up a running session', () => {
    expect(isTabTransfer(valid)).toBe(true)
    expect(isTabTransfer({ ...valid, ptyId: null, shells: [], activeShell: null })).toBe(true)
  })

  it('is refused as a bare key, which is what the channel carried before and is not enough', () => {
    expect(isTabTransfer(valid.key)).toBe(false)
  })

  it('is refused with no key, an unknown view or malformed shells', () => {
    expect(isTabTransfer({ ...valid, key: '' })).toBe(false)
    expect(isTabTransfer({ ...valid, view: 'split' })).toBe(false)
    expect(isTabTransfer({ ...valid, shells: [{ id: 1, name: 'x' }] })).toBe(false)
    expect(isTabTransfer({ ...valid, shells: undefined })).toBe(false)
    expect(isTabTransfer(null)).toBe(false)
  })
})
