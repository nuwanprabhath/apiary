// Types for dependabot-bump.mjs, so tests/integration/dependabotBump.test.ts stays strict.
export interface Update {
  name: string
  from: string
  to: string
}

export type SyncResult =
  | { action: 'bumped'; sha: string; old: string; version: string; subject: string }
  | { action: 'strip'; sha: string; old: string }
  | { action: 'skip'; reason: string }

export const DEPENDABOT: string
export const BOT: { name: string; email: string }
export function nextPatch(version: string): string
export function parseUpdates(message: string): Update[]
export function changelogSection(version: string, date: string, updates: Update[]): string
export function bumpSubject(version: string, dependabotSubject: string): string
export function applyBump(dir: string, version: string, section: string): void
export function syncBranch(opts: { dir: string; main: string; branch: string; date: string }): SyncResult
