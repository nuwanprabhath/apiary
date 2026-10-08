# ADR-0016: Refs are checked with `assertNotOption` and `--`, never with `--end-of-options`

- **Status:** Accepted
- **Context:** A ref fetched from a hostile remote can start with `-` and be read by git as a flag.
  1.26.0 guarded this by passing `--end-of-options` to `git checkout`.
- **Decision:** `src/main/git/branchOps.ts` refuses any ref starting with `-` itself
  (`assertNotOption`) and ends the arguments with a trailing `--` where git accepts one. No ref
  Apiary offers starts with `-`, so nothing is lost.
- **Alternatives tried:** `--end-of-options` (1.26.0). Before git 2.44, `checkout` (which keeps `--`
  for itself) counts it as a second ref: every branch switch failed with "fatal: only one reference
  expected, 2 given" on Ubuntu 24.04, which ships git 2.43, before git could report that the branch
  was held by another worktree. Fixed in 1.27.0 (see the CHANGELOG).
- **Consequences:** Do not reintroduce `--end-of-options` for any git version Apiary supports
  without raising the minimum git version first. Every new git call that takes a ref calls
  `assertNotOption`. Git's prose stays out of the interface ([ADR-0003](0003-git-porcelain-not-prose.md)).
- **Enforced by:** `tests/integration/branchOps.test.ts`: "never passes --end-of-options" scans the
  source for the string, and the refusal cases check `--orphan=x` is rejected by `checkoutBranch`
  and `addWorktree`.

See `branchOps.ts` and [`docs/architecture/boundaries.md`](../architecture/boundaries.md).
