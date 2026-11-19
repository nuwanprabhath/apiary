/** Types for `quality-cadence.mjs`, so its unit test can import it. */
export interface CadenceSkill { every: { commits: number; days: number }; last: { commit: string; date: string } }
export function dueReason(name: string, skill: CadenceSkill, commitsSince: number | null, daysSince: number): string | null
export function dueMessage(reasons: string[]): string
export function dueNow(now?: number): string[]
