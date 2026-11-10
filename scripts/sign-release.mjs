// Signs release/latest-*.yml with RELEASE_SIGNING_KEY (PKCS#8 PEM, Ed25519), writing <file>.sig beside each.
// Fails the release if the key is missing or is not the pair of the public key the app trusts.
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? 'release'
const fail = (message) => { console.error(`::error::${message}`); process.exit(1) }

const pem = process.env.RELEASE_SIGNING_KEY
if (!pem) fail('RELEASE_SIGNING_KEY is not set: refusing to publish an unsigned update feed')

const source = readFileSync(new URL('../src/main/update/releaseSignature.ts', import.meta.url), 'utf8')
const trusted = /-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/.exec(source)?.[0]
if (!trusted) fail('could not find the public key in releaseSignature.ts')

let privateKey
try { privateKey = createPrivateKey(pem) } catch { fail('RELEASE_SIGNING_KEY is not a valid PEM private key') }

const probe = Buffer.from('apiary release signing check')
if (!verify(null, probe, createPublicKey(trusted), sign(null, probe, privateKey))) {
  fail('RELEASE_SIGNING_KEY does not match the public key in releaseSignature.ts')
}

const feeds = readdirSync(dir).filter((f) => /^latest-.*\.yml$/.test(f))
if (feeds.length === 0) fail(`no latest-*.yml in ${dir}`)
for (const name of feeds) {
  writeFileSync(join(dir, `${name}.sig`), sign(null, readFileSync(join(dir, name)), privateKey))
  console.log(`signed ${name}`)
}
