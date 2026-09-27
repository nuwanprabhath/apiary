import { describe, it, expect } from 'vitest'
import { newPendingPtyId, isPendingPtyId, shellPtyId, parseShellPtyId } from '@shared/domain/ptyId'

describe('newPendingPtyId / isPendingPtyId', () => {
  it('mints a new: id and recognises it', () => {
    const id = newPendingPtyId('11111111-1111-1111-1111-111111111111')
    expect(id).toBe('new:11111111-1111-1111-1111-111111111111')
    expect(isPendingPtyId(id)).toBe(true)
  })

  it('does not treat a real session id as pending', () => {
    expect(isPendingPtyId('11111111-1111-1111-1111-111111111111')).toBe(false)
  })
})

describe('shellPtyId / parseShellPtyId', () => {
  it('round-trips a shell id owned by a session id', () => {
    const id = shellPtyId('11111111-1111-1111-1111-111111111111', 1)
    expect(id).toBe('shell:11111111-1111-1111-1111-111111111111:1')
    expect(parseShellPtyId(id)).toEqual({ owner: '11111111-1111-1111-1111-111111111111', terminalId: '1' })
  })

  it('round-trips a shell id owned by a pending pty id, which itself contains a colon', () => {
    const owner = newPendingPtyId('22222222-2222-2222-2222-222222222222')
    const id = shellPtyId(owner, 3)
    expect(id).toBe('shell:new:22222222-2222-2222-2222-222222222222:3')
    // The greedy first group must take everything up to the *last* colon as the owner.
    expect(parseShellPtyId(id)).toEqual({ owner, terminalId: '3' })
  })

  it('accepts a numeric or string terminal id identically', () => {
    expect(shellPtyId('k', 1)).toBe(shellPtyId('k', '1'))
  })

  it('refuses anything that is not a shell id', () => {
    expect(parseShellPtyId('11111111-1111-1111-1111-111111111111')).toBeNull()
    expect(parseShellPtyId('new:11111111-1111-1111-1111-111111111111')).toBeNull()
    expect(parseShellPtyId('shell:onlyowner')).toBeNull()
  })
})
