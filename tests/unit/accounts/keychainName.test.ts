import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { keychainServiceFor } from '../../../src/main/accounts/keychainName'

describe('keychainServiceFor', () => {
  it("main is 'Claude Code-credentials'", () => {
    expect(keychainServiceFor(null)).toBe('Claude Code-credentials')
  })

  it('folder is sha256 of the NFC path, first 8 hex', () => {
    const hash = createHash('sha256').update('/tmp/a'.normalize('NFC')).digest('hex').slice(0, 8)
    expect(keychainServiceFor('/tmp/a')).toBe(`Claude Code-credentials-${hash}`)
  })

  it('treats a decomposed path like its composed form', () => {
    expect(keychainServiceFor('/tmp/é')).toBe(keychainServiceFor('/tmp/é'))
  })
})
