import { execFileSync } from 'node:child_process'
import { app } from 'electron'

/**
 * Whether the running macOS bundle is signed with a Developer ID certificate.
 *
 * This is the one fact that decides whether macOS can update itself: Squirrel replaces a bundle
 * only if the new one satisfies the running one's designated requirement, and an ad-hoc signature
 * (what an unsigned build gets) requires an exact hash of itself, which no other build can match.
 *
 * `codesign -dv` writes its report to stderr and exits non-zero for an unsigned bundle, so both
 * are folded into "not signed" — the honest answer for anything we cannot positively confirm. A
 * wrong answer in this direction costs an unnecessary manual install; the other direction costs a
 * download that fails at the very end.
 */
export function hasDeveloperIdSignature(): boolean {
  try {
    const output = execFileSync('codesign', ['-dv', '--verbose=2', app.getAppPath()], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    })
    return /Authority=Developer ID Application/.test(output)
  } catch (e) {
    const stderr = (e as { stderr?: string | Buffer }).stderr
    const text = typeof stderr === 'string' ? stderr : stderr?.toString() ?? ''
    return /Authority=Developer ID Application/.test(text)
  }
}
