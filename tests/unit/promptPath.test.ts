import { describe, it, expect } from 'vitest'
import { promptPathEnv, writeZshShim } from '../../src/main/pty/promptPath'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

describe('the minimal prompt', () => {
  it('sets PS1 from PROMPT_COMMAND for bash, and points zsh at the shim, over the trim', () => {
    const env = promptPathEnv({ enabled: true, segments: 1, minimal: true }, '/shim', { HOME: '/home/u' })
    expect(env).toEqual({ PROMPT_COMMAND: "PS1='\\$ '", ZDOTDIR: '/shim', APIARY_USER_ZDOTDIR: '/home/u' })
    expect(env.PROMPT_DIRTRIM).toBeUndefined()
  })

  it('hands zsh the user\'s own ZDOTDIR when they have one', () => {
    expect(promptPathEnv({ enabled: false, segments: 1, minimal: true }, '/shim', { HOME: '/home/u', ZDOTDIR: '/home/u/.config/zsh' }).APIARY_USER_ZDOTDIR)
      .toBe('/home/u/.config/zsh')
  })

  it('leaves zsh alone without a shim, and the trim works as before when off', () => {
    expect(promptPathEnv({ enabled: true, segments: 1, minimal: true })).toEqual({ PROMPT_COMMAND: "PS1='\\$ '" })
    expect(promptPathEnv({ enabled: true, segments: 2, minimal: false }, '/shim')).toEqual({ PROMPT_DIRTRIM: '2' })
  })

  it('writes a shim that runs each of the user\'s zsh files and sets the prompt last', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apiary-zsh-shim-'))
    writeZshShim(dir)
    for (const f of ['.zshenv', '.zprofile', '.zshrc', '.zlogin']) {
      expect(readFileSync(join(dir, f), 'utf8')).toContain(`. "$ZDOTDIR/${f}"`)
    }
    expect(readFileSync(join(dir, '.zshrc'), 'utf8')).toContain('precmd_functions+=(_apiary_minimal_prompt)')
    rmSync(dir, { recursive: true, force: true })
  })

  it('previews as just $', () => {
    expect(previewPrompt('~/a/b/c', { enabled: true, segments: 1, minimal: true })).toBe('$')
  })
})
