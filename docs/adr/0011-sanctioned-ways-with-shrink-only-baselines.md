# ADR-0011: One sanctioned way per task, checked by a rule, with baselines that only shrink

- **Status:** Accepted
- **Context:** The 2026-10-07 review measured five feature releases written by agents. Every rule a
  compiler, linter or test enforced held. Every rule that lived only in prose or in "a helper
  exists" was broken: empty `.catch(() => {})` went from 25 to 38, `petStore.ts` copied
  `writeJsonAtomic`, two login-shell spawners appeared outside `main/exec/`, seven inline SVGs
  appeared outside `ui/icons`. An agent copies the nearest example and takes the shortest path.
- **Decision:** Each sanctioned way is an entry in `eslint/sanctioned.js` (an `apiary/*` rule with
  an allowlist of its homes and a message that names the replacement), a `dependency-cruiser` layer
  rule, or an architecture test. A rule lands as an error. Violations older than the rule go in a
  committed baseline that can only shrink; a new violation fails at once.
- **Alternatives tried:** Prose in `CLAUDE.md` plus a helper (1.28.0 to 1.32.x): the seven
  violations above. A `warn` that nobody reads was rejected before it was tried. `madge` checked only
  cycles; `dependency-cruiser` adds direction rules and a known-violations file.
- **Consequences:** Fix a baselined site, then run `npm run lint:prune`, `lint:arch:baseline` or
  `lint:dead:baseline` and commit the smaller file; a stale entry fails. Never grow a baseline or an
  allowlist to pass a check; a new rule is a `sanctioned.js` entry plus a case in the test named below.
  A rule nothing enforces goes in the "Judgment calls" list of `CLAUDE.md`, not the rule table.
- **Enforced by:** `tests/unit/architecture/sanctionedRules.test.ts` (each rule fires on its real
  mistake, stays quiet in its home), ESLint's own unused-suppression failure, `npm run lint:arch`
  with `--ignore-known`, `scripts/knip-ratchet.mjs`, and the stale-entry check in
  `tests/unit/architecture/allowlist.ts`. `npm run lint:debt` prints the totals.

See "Guard layer" in the root [`CLAUDE.md`](../../CLAUDE.md).
