---
name: architecture-drift
description: Measure how far Apiary's code has drifted from its sanctioned patterns since a base revision (the last review or release), report the trend, and hand each new drift class to the `correct` skill. Use for "architecture drift", "has the architecture held", "audit since <version>", or after every few feature releases.
---

# Architecture drift

The 2026-10-07 guardrails review found that rules a machine checked held through five releases
written by agents, and rules that lived only in prose or in a helper's existence did not. This
skill repeats that measurement, so drift is caught one release after it starts, not five.

## Inputs

- A base revision. Default: the commit of the last `docs/reviews/*` review or the previous minor
  release tag. State which one you used.

## Steps

1. **Size the change.** Run `git log --oneline <base>..HEAD` and
   `git diff --stat <base>..HEAD -- src tests`. List the new feature folders and modules.
2. **Debt trend.** Run `npm run lint:debt` now and at the base (`git worktree add` a temporary
   checkout; never stash). Every baseline should be smaller or equal. Do the same for the
   dependency-cruiser known violations, `.knip-baseline.json` and the allowlists under
   `tests/unit/architecture/`. Any growth needs a reason in the commit that grew it.
3. **Unchecked-pattern counts at both revisions.** These are things no rule covers yet. Use
   `git grep -c`:
   - `fireAndForget(` uses, and catch handlers that only comment;
   - `as` casts in `src` relative to line count;
   - `asSessionId(` and `asPtyId(` outside `state/` and `features/workspace/`;
   - files over 400 lines and functions over 120 lines (`max-lines` baseline entries);
   - `window.apiary` outside `src/renderer/state/`;
   - helpers defined twice (`tests/unit/architecture/duplicateSymbols.test.ts` output with its
     allowlist emptied);
   - new `useState`/`useEffect` in `src/renderer/app/App.tsx`, and new methods on `AppService`.
4. **Rules with no enforcer.** Read root `CLAUDE.md` "Hard rules" and "Conventions" and each
   nested `CLAUDE.md`. List every rule whose "Enforced by" is empty or prose-only, and check
   whether new code broke it.
5. **New code without a home.** For each new module, check:
   - Did it go through the sanctioned way (contract plus registrar, `main/exec`, `main/fs`
     stores, `state/` stores, `ui/` primitives, the container)?
   - Did it get a nested `CLAUDE.md`, a feature-map row and an ADR where it made a decision?
6. **Report** as a trend table (rule | enforced by | held? | evidence), following §4 of
   `docs/reviews/2026-10-07-guardrails-review.md`. Save it as `docs/reviews/<date>-drift.md`.
7. **Hand off.** A drift class that happened twice is input for the `correct` skill. List them in
   priority order, and run `correct` on each if the maintainer asks.

Read-only until step 7. Do not fix code while measuring.
