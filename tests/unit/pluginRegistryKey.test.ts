import { describe, it, expect } from 'vitest'
import { PluginRegistry } from '../../src/main/plugins/registry'

// The cache key joins folder and branch with a NUL: no path or branch name can contain one, so two
// different (cwd, branch) pairs never collide. The separator was once a raw NUL byte in the source
// (B5); writing it as the `\0` escape must keep exactly the same runtime string.
describe('PluginRegistry cache key', () => {
  const key = (cwd: string, branch?: string) =>
    (new PluginRegistry({ remoteUrl: async () => null }) as unknown as { key(ctx: { cwd: string, branch?: string }): string })
      .key({ cwd, ...(branch !== undefined ? { branch } : {}) })

  it('joins folder and branch with a single NUL character', () => {
    expect(key('/work', 'main')).toBe('/work' + String.fromCharCode(0) + 'main')
  })

  it('treats a missing branch as empty, and keeps ("a/b", "c") apart from ("a", "b/c")', () => {
    expect(key('/work')).toBe('/work' + String.fromCharCode(0))
    expect(key('a/b', 'c')).not.toBe(key('a', 'b/c'))
  })
})
