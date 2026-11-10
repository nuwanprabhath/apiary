import { createPublicKey, verify } from 'node:crypto'

/** The Ed25519 key every release's `latest-*.yml` is signed with; the private half is the release environment's secret `RELEASE_SIGNING_KEY`. */
export const RELEASE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA3R1EW3xffmzVX2eBMsO6oqbXZHBw26Tmjao0eKmy7jM=
-----END PUBLIC KEY-----
`

export const UNVERIFIED_MESSAGE = 'This update could not be verified'

/** True only when `signature` is a valid Ed25519 signature of `feed` by `publicKey`. Never throws: any failure is "not verified". */
export function verifyFeedSignature(feed: Buffer, signature: Buffer | null, publicKey: string = RELEASE_PUBLIC_KEY): boolean {
  if (signature === null || signature.length === 0) return false
  try {
    return verify(null, feed, createPublicKey(publicKey), signature)
  } catch {
    return false
  }
}
