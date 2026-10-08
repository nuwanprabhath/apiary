import { app } from 'electron'
import { createExecWithStderr } from '../exec/run'
import { errorMessage } from '@shared/errors'

/**
 * Whether the running macOS bundle is signed with a Developer ID certificate.
 *
 * This is the one fact that decides whether macOS can update itself: Squirrel replaces a bundle
 * only if the new one satisfies the running one's designated requirement, and an ad-hoc signature
 * (what an unsigned build gets) requires an exact hash of itself, which no other build can match.
 *
 * `codesign -dv` writes its report to stderr (also when it succeeds) and exits non-zero for an
 * unsigned bundle, so a failure and a report with no Developer ID authority are both folded into
 * "not signed" — the honest answer for anything we cannot positively confirm. A
 * wrong answer in this direction costs an unnecessary manual install; the other direction costs a
 * download that fails at the very end.
 */
const codesign = createExecWithStderr({ timeoutMs: 5000, scope: 'update' })
const DEVELOPER_ID = /Authority=Developer ID Application/

export async function hasDeveloperIdSignature(): Promise<boolean> {
  try {
    const { stdout, stderr } = await codesign('codesign', ['-dv', '--verbose=2', app.getAppPath()], process.cwd())
    return DEVELOPER_ID.test(`${stderr}\n${stdout}`)
  } catch (e) {
    // A failure's message is the report (stderr, then stdout); see `createExec`.
    return DEVELOPER_ID.test(errorMessage(e))
  }
}
