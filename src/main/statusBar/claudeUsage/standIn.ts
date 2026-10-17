import type { ClaudeUsageDeps } from './plugin'

/**
 * `APIARY_FAKE_USAGE` (test-only): the usage plugin shows this JSON, shaped like the usage
 * endpoint's answer, and nothing real is read or sent. The sign-in is a made-up string that only
 * this function's `fetchImpl` ever sees.
 */
export function usageStandIn(json: string): Pick<ClaudeUsageDeps, 'fetchImpl' | 'readKeychain'> {
  return {
    readKeychain: () => Promise.resolve(JSON.stringify({ claudeAiOauth: { accessToken: 'stand-in' } })),
    fetchImpl: () => Promise.resolve(new Response(json, { status: 200, headers: { 'Content-Type': 'application/json' } })),
  }
}
