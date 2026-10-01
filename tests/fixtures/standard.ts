/**
 * The standard four fixture sessions, as one literal (TEST-19). The e2e harness writes them to
 * disk, the component fake (`tests/component/fakeApiary.ts`) holds them in memory, and the contract
 * suite seeds both with them, so the ids and titles cannot drift between the three.
 * Pure data: safe to import from node and browser tests alike.
 */
import { asSessionId } from '../../src/shared/domain/ids'

export const STANDARD_SESSIONS = {
  csv: { id: asSessionId('11111111-1111-1111-1111-111111111111'), title: 'Fix CSV export bug', slug: '-work-a', firstPrompt: 'the export is empty' },
  switcher: { id: asSessionId('22222222-2222-2222-2222-222222222222'), title: 'Add worktree switcher', slug: '-work-b' },
  repoRoot: { id: asSessionId('33333333-3333-3333-3333-333333333333'), title: 'Repo root session', slug: '-repo-c' },
  worktree: { id: asSessionId('44444444-4444-4444-4444-444444444444'), title: 'Worktree session', slug: '-repo-c-wt' },
} as const
