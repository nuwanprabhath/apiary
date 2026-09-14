import { describe, it, expect } from 'vitest'
import { promptPathEnv } from '../../src/main/pty/promptPath'

describe('promptPathEnv', () => {
  it('adds nothing at all when the setting is off', () => {
    expect(promptPathEnv({ enabled: false, segments: 2 })).toEqual({})
  })

  it('asks bash to keep the last few folders', () => {
    expect(promptPathEnv({ enabled: true, segments: 2 })).toEqual({ PROMPT_DIRTRIM: '2' })
  })

  it('refuses to trim to nothing, which would leave a prompt with no path at all', () => {
    expect(promptPathEnv({ enabled: true, segments: 0 })).toEqual({ PROMPT_DIRTRIM: '1' })
    expect(promptPathEnv({ enabled: true, segments: -5 })).toEqual({ PROMPT_DIRTRIM: '1' })
  })

  it('caps a number so large that nothing would be shortened', () => {
    expect(promptPathEnv({ enabled: true, segments: 999 })).toEqual({ PROMPT_DIRTRIM: '8' })
  })

  it('rounds a fractional value rather than emitting one bash would ignore', () => {
    expect(promptPathEnv({ enabled: true, segments: 2.6 })).toEqual({ PROMPT_DIRTRIM: '3' })
  })
})
