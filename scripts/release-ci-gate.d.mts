/** Types for `release-ci-gate.mjs`, so its unit test can import it. */
export interface CiRun { databaseId: number; status: string; conclusion: string }
export function ciVerdict(runs: CiRun[], sha: string): string | null
