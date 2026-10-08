import { describe, it, expect } from 'vitest'
import { resolveConfigRoot, readsClaudeKeychain } from '../../src/main/app/config'

describe('resolveConfigRoot', () => {
  it('defaults to ~/.claude', () => {
    expect(resolveConfigRoot({}, '/home/nuwan')).toBe('/home/nuwan/.claude')
  })

  it('honours CLAUDE_CONFIG_DIR', () => {
    expect(resolveConfigRoot({ CLAUDE_CONFIG_DIR: '/tmp/cfg' }, '/home/nuwan')).toBe('/tmp/cfg')
  })

  it('ignores an empty CLAUDE_CONFIG_DIR', () => {
    expect(resolveConfigRoot({ CLAUDE_CONFIG_DIR: '' }, '/home/nuwan')).toBe('/home/nuwan/.claude')
  })
})

describe('readsClaudeKeychain', () => {
  it('reads the Keychain only on a Mac, for the default config root', () => {
    expect(readsClaudeKeychain('darwin', undefined, {})).toBe(true)
    expect(readsClaudeKeychain('darwin', undefined, { CLAUDE_CONFIG_DIR: '  ' })).toBe(true)
    expect(readsClaudeKeychain('linux', undefined, {})).toBe(false)
  })

  it('never for a test config root or a CLAUDE_CONFIG_DIR install (the packaged smoke sets the latter)', () => {
    expect(readsClaudeKeychain('darwin', '/tmp/fixture', {})).toBe(false)
    expect(readsClaudeKeychain('darwin', undefined, { CLAUDE_CONFIG_DIR: '/tmp/home/.claude' })).toBe(false)
  })
})
