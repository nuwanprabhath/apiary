import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isPairingCode, formatPairingCode, normalizePairingCode, pairingError, pairingErrorMessage, pairingNotSaved } from '@shared/domain/remote'
import { generatePairingCode, PairingStore } from '../../src/main/remote/pairingStore'

describe('PairingStore', () => {
  let dir: string
  let file: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apiary-pairing-')); file = join(dir, 'remote-pairing.json') })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('makes 8 characters with no 0, O, 1 or I', () => {
    for (let i = 0; i < 200; i++) expect(generatePairingCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
  })

  it('shows the code as XXXX-XXXX and keeps it across restarts until a new one is asked for', () => {
    const store = new PairingStore(file, () => true)
    const first = store.display()
    expect(first).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    expect(new PairingStore(file, () => true).display()).toBe(first)
    const next = store.regenerate()
    expect(next).not.toBe(normalizePairingCode(first))
    expect(new PairingStore(file, () => true).display()).toBe(formatPairingCode(next))
  })

  it('replaces a file that holds something that is not a code', () => {
    writeFileSync(file, JSON.stringify({ version: 1, code: 'not a code' }))
    expect(new PairingStore(file, () => true).code()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    expect(readFileSync(file, 'utf8')).not.toContain('not a code')
  })
})

describe('pairing codes and their errors', () => {
  it('accepts a code with or without the dash, in either case, and nothing from outside the alphabet', () => {
    for (const ok of ['KMNP-2345', 'kmnp2345', ' KMNP-2345 ']) expect(isPairingCode(ok)).toBe(true)
    for (const bad of ['KMNP-234', 'KMNP-2340', 'KMNP-234I', 'KMNP-2345-6', 7, undefined]) expect(isPairingCode(bad)).toBe(false)
  })

  it('recognises the two refusals the dialog answers, and whether the code can be remembered', () => {
    expect(pairingError(pairingErrorMessage('pairing-required', 'work-box'))).toBe('pairing-required')
    expect(pairingError(pairingErrorMessage('pairing-wrong', 'work-box'))).toBe('pairing-wrong')
    expect(pairingError(pairingErrorMessage('rate-limited', 'work-box'))).toBeNull()
    expect(pairingError('Permission denied (publickey).')).toBeNull()
    expect(pairingNotSaved(pairingErrorMessage('pairing-required', 'work-box', false))).toBe(true)
    expect(pairingNotSaved(pairingErrorMessage('pairing-required', 'work-box'))).toBe(false)
  })
})
