import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('project scaffold', () => {
  it('declares apiary as an ESM package targeting the built main entry', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.name).toBe('apiary')
    expect(pkg.type).toBe('module')
    expect(pkg.main).toBe('./out/main/index.js')
  })
})
