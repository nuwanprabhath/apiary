import { describe, it, expect } from 'vitest'
import { resolveConfigRoot, projectsDir } from '../../src/main/config'

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

describe('projectsDir', () => {
  it('points at the projects subdirectory', () => {
    expect(projectsDir('/home/nuwan/.claude')).toBe('/home/nuwan/.claude/projects')
  })
})
