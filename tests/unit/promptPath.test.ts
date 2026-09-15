import { describe, it, expect } from 'vitest'
import { promptPathEnv } from '../../src/main/pty/promptPath'
import { previewPrompt } from '../../src/shared/promptPath'

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

describe('previewPrompt', () => {
  const path = '~/projects/paratoo-fdcp.worktrees/pipeline-issues'

  it('keeps the tilde and puts the ellipsis after it, the way bash does', () => {
    // Measured against bash 5.3 rather than inferred:
    //   PROMPT_DIRTRIM=1 -> ~/.../pipeline-issues
    expect(previewPrompt(path, { enabled: true, segments: 1 }))
      .toBe('~/.../pipeline-issues')
  })

  it('shows why two folders barely shorten a worktree path', () => {
    // The whole reason the setting looked broken: the default kept almost the whole path.
    expect(previewPrompt(path, { enabled: true, segments: 2 }))
      .toBe('~/.../paratoo-fdcp.worktrees/pipeline-issues')
  })

  it('drops the leading slash of an absolute path, as bash does', () => {
    expect(previewPrompt('/tmp/a/b/c', { enabled: true, segments: 2 })).toBe('.../b/c')
  })

  it('leaves a path that is already short enough alone, with no ellipsis', () => {
    expect(previewPrompt('~/projects', { enabled: true, segments: 2 })).toBe('~/projects')
  })

  it('shows the untouched path while the setting is off', () => {
    expect(previewPrompt(path, { enabled: false, segments: 1 })).toBe(path)
  })
})
