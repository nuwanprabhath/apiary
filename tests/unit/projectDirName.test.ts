import { describe, it, expect } from 'vitest'
import { encodeProjectDirName } from '../../src/main/scanner/projectDirName'

describe('encodeProjectDirName', () => {
  it('matches the real directory Claude Code created for this exact cwd', () => {
    // Verified against a live ~/.claude/projects entry: both '/' and '.' become '-'.
    expect(encodeProjectDirName('/Users/nuwan/projects/paratoo-fdcp.worktrees/1.0.11'))
      .toBe('-Users-nuwan-projects-paratoo-fdcp-worktrees-1-0-11')
  })

  it('leaves a literal dash in a path segment untouched', () => {
    expect(encodeProjectDirName('/Users/nuwan/projects/pet-projects/apiary'))
      .toBe('-Users-nuwan-projects-pet-projects-apiary')
  })
})
