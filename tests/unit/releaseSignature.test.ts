import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { verifyFeedSignature, RELEASE_PUBLIC_KEY, UNVERIFIED_MESSAGE } from '../../src/main/update/releaseSignature'

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
