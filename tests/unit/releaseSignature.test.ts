import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { verifyFeedSignature, RELEASE_PUBLIC_KEY, UNVERIFIED_MESSAGE, servedMatchesSigned, parseFeedFacts } from '../../src/main/update/releaseSignature'

const pair = generateKeyPairSync('ed25519')
const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const feed = Buffer.from('version: 1.2.3\nfiles: []\n')
const good = sign(null, feed, pair.privateKey)

describe('verifyFeedSignature', () => {
  it('accepts a signature made by the matching key', () => {
    expect(verifyFeedSignature(feed, good, publicPem)).toBe(true)
  })
  it('rejects a feed with one byte changed', () => {
    const changed = Buffer.from(feed)
    changed.writeUInt8(changed.readUInt8(0) ^ 1, 0)
    expect(verifyFeedSignature(changed, good, publicPem)).toBe(false)
  })
  it('rejects a missing or empty signature', () => {
    expect(verifyFeedSignature(feed, null, publicPem)).toBe(false)
    expect(verifyFeedSignature(feed, Buffer.alloc(0), publicPem)).toBe(false)
  })
  it('rejects a signature from another key', () => {
    const other = generateKeyPairSync('ed25519')
    expect(verifyFeedSignature(feed, sign(null, feed, other.privateKey), publicPem)).toBe(false)
  })
  it('rejects garbage instead of throwing, and an unusable key fails closed', () => {
    expect(verifyFeedSignature(feed, Buffer.from('nope'), publicPem)).toBe(false)
    expect(verifyFeedSignature(feed, good, 'not a key')).toBe(false)
  })
  it('ships a real public key and the refusal text', () => {
    expect(RELEASE_PUBLIC_KEY).toContain('BEGIN PUBLIC KEY')
    expect(UNVERIFIED_MESSAGE).toBe('This update could not be verified')
  })
})

describe('servedMatchesSigned', () => {
  const signed = Buffer.from([
    'version: 1.2.3',
    'files:',
    '  - url: Apiary-1.2.3-arm64.dmg',
    '    sha512: AAA==',
    '    size: 10',
    "  - url: 'Apiary-1.2.3-arm64.zip'",
    '    sha512: BBB==',
    'path: Apiary-1.2.3-arm64.dmg',
    'sha512: AAA==',
    "releaseDate: '2026-11-10T00:00:00.000Z'",
  ].join('\n'))
  const files = [{ url: 'Apiary-1.2.3-arm64.dmg', sha512: 'AAA==' }, { url: 'Apiary-1.2.3-arm64.zip', sha512: 'BBB==' }]

  it('accepts a served feed that says what the signed one says', () => {
    expect(servedMatchesSigned(signed, { version: '1.2.3', files })).toBe(true)
  })
  it('refuses another version, another hash, or another set of files', () => {
    expect(servedMatchesSigned(signed, { version: '1.2.4', files })).toBe(false)
    expect(servedMatchesSigned(signed, { version: '1.2.3', files: [files[0], { ...files[1], sha512: 'EVIL==' }] })).toBe(false)
    expect(servedMatchesSigned(signed, { version: '1.2.3', files: [files[0]] })).toBe(false)
  })
  it('refuses a signed feed it cannot read', () => {
    expect(servedMatchesSigned(Buffer.from('files: []\n'), { version: '1.2.3', files: [] })).toBe(false)
    expect(parseFeedFacts('version: 1\nfiles:\n  - url: x\n')).toBeNull()
  })
})
