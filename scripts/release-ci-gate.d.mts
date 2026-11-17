/** Types for `release-ci-gate.mjs`, so its unit test can import it. */
export interface CiRun { databaseId: number; status: string; conclusion: string }
export function ciVerdict(runs: CiRun[], sha: string): string | null
export interface OpenIssue { number: number; title: string; labels: Array<{ name: string }> }
export function nightlyVerdict(issues: OpenIssue[]): string | null
