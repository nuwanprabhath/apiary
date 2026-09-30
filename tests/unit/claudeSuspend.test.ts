import { describe, expect, it } from 'vitest'
import { isClaudeSuspended, isSuspendChord } from '../../src/shared/claudeSuspend'

const SUSPENDED = [
  'Claude Code has been suspended. Run `fg` to bring Claude Code back.',
  'Note: ctrl + z now suspends Claude Code, ctrl + _ undoes input.',
]

describe('isClaudeSuspended', () => {
  it('recognises the lines Claude Code prints when Ctrl+Z suspends it', () => {
    expect(isClaudeSuspended(['$ earlier output', ...SUSPENDED, '', ''])).toBe(true)
  })

  it('does not count a suspension far up the scrollback once Claude has repainted below it', () => {
    expect(isClaudeSuspended([...SUSPENDED, 'a', 'b', 'c', 'd', 'e'])).toBe(false)
  })

  it('is false for an ordinary Claude screen', () => {
    expect(isClaudeSuspended(['❯ hello draft', '  Haiku 4.5', '  ⏸ manual mode on'])).toBe(false)
  })
})

describe('isSuspendChord', () => {
  const key = (k: string, mods: Partial<Record<'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey', boolean>> = {}) =>
    ({ key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods })

  it('is Ctrl+Z, whatever the case of the key', () => {
    expect(isSuspendChord(key('z', { ctrlKey: true }))).toBe(true)
    expect(isSuspendChord(key('Z', { ctrlKey: true }))).toBe(true)
  })

  it('leaves Ctrl+Shift+Z, Cmd+Z and a bare z alone', () => {
    expect(isSuspendChord(key('z', { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isSuspendChord(key('z', { metaKey: true }))).toBe(false)
    expect(isSuspendChord(key('z'))).toBe(false)
  })
})
