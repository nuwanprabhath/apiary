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

export interface FeedFile { url: string; sha512: string }
export interface FeedFacts { version: string; files: FeedFile[] }

function unquote(v: string): string {
  const t = v.trim()
  return (t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"')) ? t.slice(1, -1) : t
}

/**
 * Reads `version` and `files[].url` / `files[].sha512` from a `latest-*.yml` as electron-builder
 * writes it (flat keys, one `files:` list of maps). Null when the version or a file's url or hash is missing.
 */
export function parseFeedFacts(text: string): FeedFacts | null {
  let version: string | null = null
  const files: Partial<FeedFile>[] = []
  let inFiles = false
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const top = /^([A-Za-z0-9_]+):(.*)$/.exec(line)
    if (top !== null) {
      inFiles = top[1] === 'files'
      if (top[1] === 'version') version = unquote(top[2])
      continue
    }
    const item = inFiles ? /^\s+(-\s+)?([A-Za-z0-9_]+):(.*)$/.exec(line) : null
    if (item === null) continue
    if (item[1] !== undefined) files.push({})
    const current = files.at(-1)
    if (current === undefined) return null
    if (item[2] === 'url') current.url = unquote(item[3])
    if (item[2] === 'sha512') current.sha512 = unquote(item[3])
  }
  if (version === null || version === '') return null
  const complete: FeedFile[] = []
  for (const f of files) {
    if (f.url === undefined || f.sha512 === undefined) return null
    complete.push({ url: f.url, sha512: f.sha512 })
  }
  return { version, files: complete }
}

/**
 * True when what electron-updater was served names the signed feed's version and lists exactly its
 * files and hashes. Otherwise a served feed could name an older, genuinely signed version while
 * listing another installer's hash.
 */
export function servedMatchesSigned(signedFeed: Buffer, served: { version: string; files: readonly FeedFile[] }): boolean {
  const signed = parseFeedFacts(signedFeed.toString('utf8'))
  if (signed === null || signed.version !== served.version) return false
  if (signed.files.length !== served.files.length) return false
  return served.files.every((s) => signed.files.some((f) => f.url === s.url && f.sha512 === s.sha512))
}
